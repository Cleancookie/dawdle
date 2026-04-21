<?php

namespace Modules\Game\Services;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Modules\Game\Events\GameEnded;
use Modules\Game\Events\Pictionary\PictCanvasClear;
use Modules\Game\Events\Pictionary\PictGuessCorrect;
use Modules\Game\Events\Pictionary\PictRoundEnded;
use Modules\Game\Events\Pictionary\PictRoundStarted;
use Modules\Game\Events\Pictionary\PictStroke;
use Modules\Game\Events\TttMoveMade;
use Modules\Game\Models\GameResult;
use Modules\Game\Models\GameSession;
use Modules\Game\Services\Pictionary\GameLogic as PictGameLogic;
use Modules\Game\Services\TicTacToe\GameLogic as TttGameLogic;
use Modules\Room\Events\GameStarted;
use Modules\Room\Services\RoomService;

class GameService
{
    public function __construct(private RoomService $roomService) {}

    public function startGame(string $roomId, array $playerGuestIds, string $gameType): array
    {
        $session = GameSession::forceCreate([
            'id' => strtolower((string) Str::ulid()),
            'room_id' => $roomId,
            'game_type' => $gameType,
            'status' => 'in_progress',
            'started_at' => now(),
        ]);
        $gameId = $session->id;

        if ($gameType === 'tic_tac_toe') {
            shuffle($playerGuestIds);
            $playerX = $playerGuestIds[0];
            $playerO = $playerGuestIds[1];
            $state = TttGameLogic::initialState($gameId, $roomId, $playerX, $playerO);
            $players = [['guestId' => $playerX], ['guestId' => $playerO]];
            $firstTurn = $playerX;
        } elseif ($gameType === 'pictionary') {
            $state = PictGameLogic::initialState($gameId, $roomId, $playerGuestIds);
            $players = array_map(fn ($id) => ['guestId' => $id], $state['playerOrder']);
            $firstTurn = $state['currentDrawer'];
        } else {
            throw new \InvalidArgumentException('Unsupported game type');
        }

        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
        $this->roomService->setStatus($roomId, 'playing');

        broadcast(new GameStarted($roomId, $gameId, $gameType, $players, $firstTurn));

        if ($gameType === 'pictionary') {
            $this->broadcastRoundStarted($roomId, $gameId, $state);
        }

        return ['gameId' => $gameId, 'state' => $state];
    }

    public function applyMove(string $gameId, string $guestId, array $moveData): array
    {
        $raw = Redis::get("dawdle:game:{$gameId}:state");
        if ($raw === null) {
            throw new \RuntimeException('Game state not found');
        }

        $state = json_decode($raw, true);
        $gameType = $state['gameType'];

        if ($gameType === 'tic_tac_toe') {
            return $this->applyTttMove($gameId, $guestId, $moveData, $state);
        }

        if ($gameType === 'pictionary') {
            return $this->applyPictionaryMove($gameId, $guestId, $moveData, $state);
        }

        throw new \RuntimeException('Unknown game type: '.$gameType);
    }

    public function getState(string $gameId): ?array
    {
        $raw = Redis::get("dawdle:game:{$gameId}:state");

        return $raw !== null ? json_decode($raw, true) : null;
    }

    private function applyTttMove(string $gameId, string $guestId, array $moveData, array $state): array
    {
        $state = TttGameLogic::applyMove($state, $guestId, $moveData['index']);

        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);

        $symbol = $state['players']['X'] === $guestId ? 'X' : 'O';
        $isFinished = $state['status'] === 'finished';

        broadcast(new TttMoveMade(
            $state['roomId'],
            $gameId,
            $moveData['index'],
            $symbol,
            $isFinished ? null : $state['currentTurn'],
            $state['status'],
            $state['winner'],
        ));

        if ($isFinished) {
            $this->endGame($gameId, $state);
        }

        return $state;
    }

    private function applyPictionaryMove(string $gameId, string $guestId, array $moveData, array $state): array
    {
        $roomId = $state['roomId'];
        $type = $moveData['type'] ?? '';

        if ($type === 'pict.stroke') {
            if ($guestId !== $state['currentDrawer']) {
                throw new \DomainException('Only the drawer can send strokes.');
            }
            broadcast(new PictStroke(
                $roomId,
                $gameId,
                $moveData['points'] ?? [],
                $moveData['color'] ?? '#000000',
                $moveData['width'] ?? 2,
                $moveData['isEraser'] ?? false,
            ))->toOthers();

            return $state;
        }

        if ($type === 'pict.canvas_clear') {
            if ($guestId !== $state['currentDrawer']) {
                throw new \DomainException('Only the drawer can clear the canvas.');
            }
            broadcast(new PictCanvasClear($roomId, $gameId))->toOthers();

            return $state;
        }

        if ($type === 'pict.guess') {
            $state = PictGameLogic::applyGuess($state, $guestId, $moveData['guess'] ?? '');

            if ($state['result'] === 'correct') {
                Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);

                $displayName = $this->getDisplayName($guestId);
                broadcast(new PictGuessCorrect($roomId, $gameId, $guestId, $displayName));

                // All non-drawers have guessed — end the round
                $nonDrawers = array_filter($state['playerOrder'], fn ($id) => $id !== $state['currentDrawer']);
                $allGuessed = count(array_diff($nonDrawers, $state['guessedCorrect'])) === 0;
                if ($allGuessed) {
                    $this->endRound($gameId, $state);
                }
            }

            return $state;
        }

        if ($type === 'pict.timeout') {
            $this->endRound($gameId, $state);

            return $state;
        }

        throw new \InvalidArgumentException('Unknown move type: '.$type);
    }

    private function endRound(string $gameId, array $state): void
    {
        $roomId = $state['roomId'];

        // Build round scores from the current cumulative scores (we track total)
        $scores = [];
        foreach ($state['scores'] as $guestId => $total) {
            $scores[] = ['guestId' => $guestId, 'score' => $total];
        }

        broadcast(new PictRoundEnded($roomId, $gameId, $state['word'], $scores));

        $state = PictGameLogic::advanceRound($state);

        if ($state['status'] === 'finished') {
            // Save final state before ending
            Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
            $this->endGame($gameId, $state);

            return;
        }

        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);

        $this->broadcastRoundStarted($roomId, $gameId, $state);
    }

    private function broadcastRoundStarted(string $roomId, string $gameId, array $state): void
    {
        $drawerGuestId     = $state['currentDrawer'];
        $drawerDisplayName = $this->getDisplayName($drawerGuestId);

        broadcast(new PictRoundStarted(
            $roomId,
            $gameId,
            $state['round'],
            $state['totalRounds'],
            $drawerGuestId,
            $drawerDisplayName,
            $state['timeLimit'],
        ));

    }

    private function endGame(string $gameId, array $state): void
    {
        $session = GameSession::findOrFail($gameId);
        $roomId = $session->room_id;

        if ($state['gameType'] === 'pictionary') {
            $scoresMap = $state['scores'];
            arsort($scoresMap);
            $winnerGuestId = array_key_first($scoresMap);
            $scores = [];
            $placement = 1;

            foreach ($scoresMap as $guestId => $score) {
                GameResult::create([
                    'game_session_id' => $gameId,
                    'guest_id' => $guestId,
                    'score' => $score,
                    'placement' => $placement++,
                ]);
                $scores[] = ['guestId' => $guestId, 'score' => $score];
            }

            $session->update([
                'status' => 'completed',
                'ended_at' => now(),
                'winner_guest_id' => $winnerGuestId,
            ]);

            broadcast(new GameEnded($roomId, $gameId, $scores, $winnerGuestId));
        } else {
            // Tic Tac Toe
            $winner = $state['winner'];
            $scores = [];

            foreach ($state['players'] as $guestId) {
                $isWinner = $winner !== null && $guestId === $winner;
                $score = $isWinner ? 1 : 0;
                $placement = $isWinner ? 1 : 2;

                GameResult::create([
                    'game_session_id' => $gameId,
                    'guest_id' => $guestId,
                    'score' => $score,
                    'placement' => $placement,
                ]);

                $scores[] = ['guestId' => $guestId, 'score' => $score];
            }

            $session->update([
                'status' => 'completed',
                'ended_at' => now(),
                'winner_guest_id' => $winner,
            ]);

            broadcast(new GameEnded($roomId, $gameId, $scores, $winner));
        }

        Redis::del("dawdle:game:{$gameId}:state");
        Redis::del("dawdle:room:{$roomId}:ready");
        $this->roomService->setStatus($roomId, 'waiting');
    }

    private function getDisplayName(string $guestId): string
    {
        return Redis::hget("dawdle:guest:{$guestId}", 'displayName') ?? 'Unknown';
    }
}
