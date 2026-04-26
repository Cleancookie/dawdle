<?php

namespace Modules\Game\Services;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Modules\Game\Enums\GameType;
use Modules\Game\Events\GameEnded;
use Modules\Game\Events\GamePlayerJoined;
use Modules\Game\Models\GameResult;
use Modules\Game\Models\GameSession;
use Modules\Board\Events\BoardCursorMoved;
use Modules\Board\Events\BoardObjectDragging;
use Modules\Board\Events\BoardObjectGrabbed;
use Modules\Board\Events\BoardObjectsChanged;
use Modules\Board\Services\GameLogic as BoardGameLogic;
use Modules\Pack\Events\PackAnswerSubmitted;
use Modules\Pack\Events\PackRoundEnded;
use Modules\Pack\Events\PackRoundStarted;
use Modules\Pack\Services\GameLogic as PackGameLogic;
use Modules\Pictionary\Events\PictCanvasClear;
use Modules\Pictionary\Events\PictGuessCorrect;
use Modules\Pictionary\Events\PictRoundEnded;
use Modules\Pictionary\Events\PictRoundStarted;
use Modules\Pictionary\Events\PictStroke;
use Modules\Pictionary\Services\GameLogic as PictGameLogic;
use Modules\Room\Events\GameStarted;
use Modules\Room\Services\RoomService;
use Modules\Spotto\Events\SpottoHover;
use Modules\Spotto\Events\SpottoPointScored;
use Modules\Spotto\Events\SpottoRoundStarted;
use Modules\Spotto\Services\GameLogic as SpottoGameLogic;
use Modules\TicTacToe\Events\TttMoveMade;
use Modules\TicTacToe\Services\GameLogic as TttGameLogic;

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

        [$state, $players, $firstTurn] = match (GameType::from($gameType)) {
            GameType::TicTacToe => (static function () use ($gameId, $roomId, $playerGuestIds) {
                shuffle($playerGuestIds);
                [$playerX, $playerO] = $playerGuestIds;
                $state = TttGameLogic::initialState($gameId, $roomId, $playerX, $playerO);

                return [$state, [['guestId' => $playerX], ['guestId' => $playerO]], $playerX];
            })(),
            GameType::Pictionary => (static function () use ($gameId, $roomId, $playerGuestIds) {
                $state = PictGameLogic::initialState($gameId, $roomId, $playerGuestIds);

                return [$state, array_map(fn ($id) => ['guestId' => $id], $state['playerOrder']), $state['currentDrawer']];
            })(),
            GameType::Spotto => (static function () use ($gameId, $roomId, $playerGuestIds) {
                $state = SpottoGameLogic::initialState($gameId, $roomId, $playerGuestIds);

                return [$state, array_map(fn ($id) => ['guestId' => $id], $state['playerOrder']), null];
            })(),
            GameType::Pack => (static function () use ($gameId, $roomId, $playerGuestIds) {
                $state = PackGameLogic::initialState($gameId, $roomId, $playerGuestIds);

                return [$state, array_map(fn ($id) => ['guestId' => $id], $state['playerOrder']), null];
            })(),
            GameType::Board => (static function () use ($gameId, $roomId, $playerGuestIds) {
                $state = BoardGameLogic::initialState($gameId, $roomId, $playerGuestIds);

                return [$state, array_map(fn ($id) => ['guestId' => $id], $playerGuestIds), null];
            })(),
        };

        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
        $this->roomService->setStatus($roomId, 'playing');

        broadcast(new GameStarted($roomId, $gameId, $gameType, $players, $firstTurn));

        match (GameType::from($gameType)) {
            GameType::Pictionary => $this->broadcastRoundStarted($roomId, $gameId, $state),
            GameType::Spotto     => $this->broadcastSpottoRoundStarted($roomId, $gameId, $state),
            GameType::Pack       => $this->broadcastPackRoundStarted($roomId, $gameId, $state),
            default              => null,
        };

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

        return match (GameType::from($gameType)) {
            GameType::TicTacToe  => $this->applyTttMove($gameId, $guestId, $moveData, $state),
            GameType::Pictionary => $this->applyPictionaryMove($gameId, $guestId, $moveData, $state),
            GameType::Spotto     => $this->applySpottoMove($gameId, $guestId, $moveData, $state),
            GameType::Pack       => $this->applyPackMove($gameId, $guestId, $moveData, $state),
            GameType::Board      => $this->applyBoardMove($gameId, $guestId, $moveData, $state),
        };
    }

    public function getState(string $gameId): ?array
    {
        $raw = Redis::get("dawdle:game:{$gameId}:state");

        return $raw !== null ? json_decode($raw, true) : null;
    }

    public function joinGame(string $gameId, string $guestId): array
    {
        $raw = Redis::get("dawdle:game:{$gameId}:state");
        if ($raw === null) {
            throw new \RuntimeException('Game state not found');
        }

        $state = json_decode($raw, true);

        if ($state['status'] !== 'in_progress') {
            throw new \DomainException('Game is not in progress');
        }

        $playerOrder = $state['playerOrder'] ?? array_values($state['players'] ?? []);
        if (in_array($guestId, $playerOrder, true)) {
            return $state; // already a player
        }

        $max = $this->maxPlayers(GameType::from($state['gameType']));
        if (count($playerOrder) >= $max) {
            throw new \DomainException('Game is full');
        }

        $state['playerOrder'][] = $guestId;
        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);

        $roomId      = $state['roomId'];
        $displayName = $this->getDisplayName($guestId);
        $players     = array_map(fn ($id) => ['guestId' => $id], $state['playerOrder']);

        broadcast(new GamePlayerJoined($roomId, $gameId, $guestId, $displayName, $players));

        // Also add to room players set so the guest is recognised as a player on reconnect
        Redis::sadd("dawdle:room:{$roomId}:players", $guestId);

        return $state;
    }

    public function minPlayers(string $gameType): int
    {
        return match (GameType::from($gameType)) {
            GameType::TicTacToe  => TttGameLogic::MIN_PLAYERS,
            GameType::Pictionary => PictGameLogic::MIN_PLAYERS,
            GameType::Spotto     => SpottoGameLogic::MIN_PLAYERS,
            GameType::Pack       => PackGameLogic::MIN_PLAYERS,
            GameType::Board      => BoardGameLogic::MIN_PLAYERS,
        };
    }

    private function maxPlayers(GameType $type): int
    {
        return match ($type) {
            GameType::TicTacToe  => TttGameLogic::MAX_PLAYERS,
            GameType::Pictionary => PictGameLogic::MAX_PLAYERS,
            GameType::Spotto     => SpottoGameLogic::MAX_PLAYERS,
            GameType::Pack       => PackGameLogic::MAX_PLAYERS,
            GameType::Board      => BoardGameLogic::MAX_PLAYERS,
        };
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

        if ($type === 'pict.stroke' || $type === 'pict.stroke_delta') {
            if ($guestId !== $state['currentDrawer']) {
                throw new \DomainException('Only the drawer can send strokes.');
            }
            broadcast(new PictStroke(
                $roomId,
                $gameId,
                $guestId,
                $type,
                $moveData['points'] ?? [],
                $moveData['color'] ?? '#000000',
                $moveData['width'] ?? 2,
                $moveData['isEraser'] ?? false,
                $moveData['strokeId'] ?? null,
                $moveData['final'] ?? true,
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

    private function applySpottoMove(string $gameId, string $guestId, array $moveData, array $state): array
    {
        $type = $moveData['type'] ?? '';

        if ($type === 'spotto.hover') {
            broadcast(new SpottoHover(
                $state['roomId'],
                $gameId,
                $guestId,
                (int) ($moveData['symbolIdx'] ?? -1),
                (string) ($moveData['cardId'] ?? 'center'),
            ))->toOthers();

            return $state;
        }

        if ($type !== 'spotto.guess') {
            throw new \InvalidArgumentException('Unknown move type: '.$type);
        }

        $roomId = $state['roomId'];
        $symbolIdx = (int) ($moveData['symbolIdx'] ?? -1);

        $state = SpottoGameLogic::applyGuess($state, $guestId, $symbolIdx);

        $scores = [];
        foreach ($state['scores'] as $id => $score) {
            $scores[] = ['guestId' => $id, 'score' => $score];
        }

        broadcast(new SpottoPointScored(
            $roomId, $gameId, $guestId,
            $this->getDisplayName($guestId),
            $symbolIdx, $scores,
        ));

        $state = SpottoGameLogic::advanceRound($state);
        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);

        if ($state['status'] === 'finished') {
            $this->endGame($gameId, $state);
        } else {
            $this->broadcastSpottoRoundStarted($roomId, $gameId, $state);
        }

        return $state;
    }

    private function broadcastSpottoRoundStarted(string $roomId, string $gameId, array $state): void
    {
        broadcast(new SpottoRoundStarted(
            $roomId, $gameId,
            $state['round'],
            $state['totalRounds'],
            $state['centerCard'],
            $state['playerCards'],
            $state['symbols'],
            $state['centerLayout'] ?? [],
            $state['playerLayouts'] ?? [],
        ));
    }

    private function broadcastRoundStarted(string $roomId, string $gameId, array $state): void
    {
        $drawerGuestId = $state['currentDrawer'];
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

        $type = GameType::from($state['gameType']);

        if (in_array($type, [GameType::Pictionary, GameType::Spotto, GameType::Pack])) {
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

    // ── Pack ──────────────────────────────────────────────────────────────────

    private function applyPackMove(string $gameId, string $guestId, array $moveData, array $state): array
    {
        $roomId = $state['roomId'];
        $type   = $moveData['type'] ?? '';

        if ($type === 'pack.answer') {
            $state = PackGameLogic::submitAnswer($state, $guestId, $moveData['answer'] ?? '');

            $answered = count($state['pendingAnswers']) + ($state['phase'] === 'reveal' ? count($state['answers']) : 0);
            $total    = count($state['playerOrder']);

            if ($state['phase'] === 'reveal') {
                Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
                $this->broadcastPackRoundEnded($roomId, $gameId, $state);
            } else {
                Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
                broadcast(new PackAnswerSubmitted($roomId, $gameId, $guestId, count($state['pendingAnswers']), $total));
            }

            return $state;
        }

        if ($type === 'pack.timeout') {
            if ($state['phase'] !== 'answering') return $state;
            $state = PackGameLogic::revealAnswers($state);
            Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
            $this->broadcastPackRoundEnded($roomId, $gameId, $state);

            return $state;
        }

        if ($type === 'pack.advance') {
            if ($state['phase'] !== 'reveal') return $state;
            $state = PackGameLogic::advanceRound($state);
            Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);

            if ($state['status'] === 'finished') {
                $this->endGame($gameId, $state);
            } else {
                $this->broadcastPackRoundStarted($roomId, $gameId, $state);
            }

            return $state;
        }

        throw new \InvalidArgumentException('Unknown move type: '.$type);
    }

    private function broadcastPackRoundEnded(string $roomId, string $gameId, array $state): void
    {
        $result  = $state['roundResult'] ?? [];
        $answers = [];
        foreach ($state['answers'] as $id => $answer) {
            $answers[] = [
                'guestId'  => $id,
                'answer'   => $answer,
                'isWinner' => in_array($id, $result['winners'] ?? []),
            ];
        }
        $scores = [];
        foreach ($state['scores'] as $id => $score) {
            $scores[] = ['guestId' => $id, 'score' => $score];
        }
        broadcast(new PackRoundEnded(
            $roomId, $gameId,
            $state['question'],
            $answers,
            $result['mostCommon'] ?? null,
            $result['winners'] ?? [],
            $scores,
        ));
    }

    private function broadcastPackRoundStarted(string $roomId, string $gameId, array $state): void
    {
        broadcast(new PackRoundStarted(
            $roomId, $gameId,
            $state['round'],
            $state['totalRounds'],
            $state['question'],
            $state['timeLimit'],
        ));
    }

    // ── Board ─────────────────────────────────────────────────────────────────

    private function applyBoardMove(string $gameId, string $guestId, array $moveData, array $state): array
    {
        $roomId = $state['roomId'];
        $type   = $moveData['type'] ?? '';

        if ($type === 'board.object_grab') {
            $id = $moveData['id'] ?? null;
            if (!$id || !isset($state['objects'][$id])) return $state;
            broadcast(new BoardObjectGrabbed($roomId, $guestId, $id))->toOthers();
            return $state;
        }

        if ($type === 'board.object_drag') {
            $id = $moveData['id'] ?? null;
            if (!$id || !isset($state['objects'][$id])) return $state;
            broadcast(new BoardObjectDragging(
                $roomId, $guestId, $id,
                (float) ($moveData['x'] ?? 0),
                (float) ($moveData['y'] ?? 0),
            ))->toOthers();
            return $state;
        }

        if ($type === 'board.cursor') {
            // Cursors are ephemeral — broadcast only, no Redis write
            broadcast(new BoardCursorMoved(
                $roomId,
                $guestId,
                $this->getDisplayName($guestId),
                (float) ($moveData['x']    ?? 0),
                (float) ($moveData['y']    ?? 0),
                (float) ($moveData['camX'] ?? 0),
                (float) ($moveData['camY'] ?? 0),
                (float) ($moveData['camW'] ?? 0),
                (float) ($moveData['camH'] ?? 0),
            ));

            return $state;
        }

        if ($type === 'board.object_move') {
            $id = $moveData['id'] ?? null;
            if (!$id || !isset($state['objects'][$id])) return $state;
            $state['objects'][$id]['x']        = (float) ($moveData['x'] ?? 0);
            $state['objects'][$id]['y']        = (float) ($moveData['y'] ?? 0);
            $state['objects'][$id]['holderId'] = null;
            Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
            broadcast(new BoardObjectsChanged($roomId, [$state['objects'][$id]]));
            return $state;
        }

        if ($type === 'board.object_take') {
            $id = $moveData['id'] ?? null;
            if (!$id || !isset($state['objects'][$id])) return $state;
            $state['objects'][$id]['holderId'] = $guestId;
            Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
            broadcast(new BoardObjectsChanged($roomId, [$state['objects'][$id]]));
            return $state;
        }

        if ($type === 'board.object_place') {
            $id = $moveData['id'] ?? null;
            if (!$id || !isset($state['objects'][$id])) return $state;
            $state['objects'][$id]['x']        = (float) ($moveData['x'] ?? 0);
            $state['objects'][$id]['y']        = (float) ($moveData['y'] ?? 0);
            $state['objects'][$id]['holderId'] = null;
            Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 14400);
            broadcast(new BoardObjectsChanged($roomId, [$state['objects'][$id]]));
            return $state;
        }

        if ($type === 'board.end') {
            $this->endGame($gameId, $state);

            return $state;
        }

        return $state;
    }
}
