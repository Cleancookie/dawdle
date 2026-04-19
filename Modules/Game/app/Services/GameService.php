<?php

namespace Modules\Game\Services;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Modules\Game\Events\GameEnded;
use Modules\Game\Events\TttMoveMade;
use Modules\Game\Models\GameResult;
use Modules\Game\Models\GameSession;
use Modules\Game\Services\TicTacToe\GameLogic;
use Modules\Room\Events\GameStarted;
use Modules\Room\Models\Room;

class GameService
{
    public function startGame(string $roomId, array $playerGuestIds, string $gameType): array
    {
        if ($gameType !== 'tic_tac_toe') {
            throw new \InvalidArgumentException('Unsupported game type');
        }

        shuffle($playerGuestIds);
        $playerX = $playerGuestIds[0];
        $playerO = $playerGuestIds[1];

        $session = GameSession::forceCreate([
            'id'         => strtolower((string) Str::ulid()),
            'room_id'    => $roomId,
            'game_type'  => $gameType,
            'status'     => 'in_progress',
            'started_at' => now(),
        ]);
        $gameId = $session->id;

        $state = GameLogic::initialState($gameId, $roomId, $playerX, $playerO);

        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 7200);
        Redis::hset("dawdle:room:{$roomId}", 'status', 'playing');
        Room::where('id', $roomId)->update(['status' => 'playing']);

        $players = [['guestId' => $playerX], ['guestId' => $playerO]];
        broadcast(new GameStarted($roomId, $gameId, $gameType, $players, $playerX));

        return ['gameId' => $gameId, 'state' => $state];
    }

    public function applyMove(string $gameId, string $guestId, array $moveData): array
    {
        $raw = Redis::get("dawdle:game:{$gameId}:state");
        if ($raw === null) {
            throw new \RuntimeException('Game state not found');
        }

        $state = json_decode($raw, true);
        $state = GameLogic::applyMove($state, $guestId, $moveData['index']);

        Redis::set("dawdle:game:{$gameId}:state", json_encode($state), 'EX', 7200);

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

    public function getState(string $gameId): ?array
    {
        $raw = Redis::get("dawdle:game:{$gameId}:state");

        return $raw !== null ? json_decode($raw, true) : null;
    }

    private function endGame(string $gameId, array $state): void
    {
        $session = GameSession::findOrFail($gameId);

        $session->update([
            'status'          => 'completed',
            'ended_at'        => now(),
            'winner_guest_id' => $state['winner'],
        ]);

        $winner = $state['winner'];
        $scores = [];

        // $state['players'] is ['X' => guestId, 'O' => guestId]
        foreach ($state['players'] as $guestId) {
            $isWinner = $winner !== null && $guestId === $winner;
            $score = $isWinner ? 1 : 0;
            $placement = $isWinner ? 1 : 2;

            GameResult::create([
                'game_session_id' => $gameId,
                'guest_id'        => $guestId,
                'score'           => $score,
                'placement'       => $placement,
            ]);

            $scores[] = ['guestId' => $guestId, 'score' => $score];
        }

        $roomId = $session->room_id;

        broadcast(new GameEnded($roomId, $gameId, $scores, $winner));

        Redis::del("dawdle:game:{$gameId}:state");
        Redis::del("dawdle:room:{$roomId}:ready");
        Redis::hset("dawdle:room:{$roomId}", 'status', 'waiting');
        Room::where('id', $roomId)->update(['status' => 'waiting']);
    }
}
