<?php

namespace Modules\Room\Services;

use Illuminate\Support\Facades\Redis;
use Modules\Game\Models\GameSession;
use Modules\Room\Events\ChatMessageSent;
use Modules\Room\Events\PlayerJoined;
use Modules\Room\Events\PlayerLeft;
use Modules\Room\Events\PlayerReady;
use Modules\Room\Models\Room;
use Modules\Room\Models\RoomGuest;

class RoomService
{
    public function create(string $guestId, string $displayName): array
    {
        $attempts = 0;
        do {
            if (++$attempts > 10) {
                throw new \RuntimeException('Could not generate unique room code');
            }
            $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while (Room::where('code', $code)->exists());

        $room = Room::create([
            'code'          => $code,
            'status'        => 'waiting',
            'host_guest_id' => $guestId,
        ]);

        Redis::hset(
            "dawdle:room:{$room->id}",
            'status', 'waiting',
            'code', $code,
            'hostGuestId', $guestId,
            'selectedGame', 'tic_tac_toe',
            'lastActivityAt', now()->toISOString(),
        );
        Redis::expire("dawdle:room:{$room->id}", 7200);

        Redis::hset("dawdle:guest:{$guestId}", 'displayName', $displayName, 'roomId', $room->id, 'role', 'player');
        Redis::expire("dawdle:guest:{$guestId}", 86400);
        Redis::sadd("dawdle:room:{$room->id}:players", $guestId);

        RoomGuest::create([
            'room_id'      => $room->id,
            'guest_id'     => $guestId,
            'display_name' => $displayName,
            'role'         => 'player',
            'joined_at'    => now(),
        ]);

        return [
            'roomId'    => $room->id,
            'code'      => $room->code,
            'inviteUrl' => url('/room/' . $room->code),
        ];
    }

    public function get(string $code): ?array
    {
        $room = Room::where('code', $code)->first();

        if (!$room || $room->status === 'closed') {
            return null;
        }

        $selectedGame = Redis::hget("dawdle:room:{$room->id}", 'selectedGame') ?: 'tic_tac_toe';

        $result = [
            'roomId'       => $room->id,
            'code'         => $room->code,
            'status'       => $room->status,
            'hostGuestId'  => $room->host_guest_id,
            'selectedGame' => $selectedGame,
        ];

        // Include active game session so reconnecting clients can restore game phase.
        if ($room->status === 'playing') {
            $session = GameSession::where('room_id', $room->id)
                ->where('status', 'in_progress')
                ->latest('started_at')
                ->first();

            if ($session) {
                $raw = Redis::get("dawdle:game:{$session->id}:state");
                if ($raw !== null) {
                    $state = json_decode($raw, true);
                    $playerOrder = $state['playerOrder']
                        ?? array_values($state['players'] ?? []);

                    $players = array_map(
                        fn ($id) => ['guestId' => $id],
                        $playerOrder,
                    );

                    $result['activeGame'] = [
                        'gameId'    => $session->id,
                        'gameType'  => $session->game_type,
                        'players'   => $players,
                        'firstTurn' => $state['currentTurn'] ?? $state['currentDrawer'] ?? null,
                    ];
                }
            }
        }

        return $result;
    }

    public function join(string $code, string $guestId, string $displayName): array
    {
        $room = Room::where('code', $code)->firstOrFail();

        if ($room->status === 'closed') {
            throw new \InvalidArgumentException('Room is closed');
        }

        $status = Redis::hget("dawdle:room:{$room->id}", 'status') ?? $room->status;

        // Determine role: preserve player status for guests reconnecting mid-game.
        $existingGuest = Redis::hget("dawdle:guest:{$guestId}", 'roomId');
        $wasPlayer     = Redis::sismember("dawdle:room:{$room->id}:players", $guestId);
        $role = ($status === 'waiting' || $wasPlayer) ? 'player' : 'spectator';

        $existing = RoomGuest::where('room_id', $room->id)->where('guest_id', $guestId)->first();

        if ($existing && $existing->left_at !== null) {
            $existing->update(['left_at' => null, 'role' => $role, 'joined_at' => now()]);
        } elseif (!$existing) {
            RoomGuest::create([
                'room_id'      => $room->id,
                'guest_id'     => $guestId,
                'display_name' => $displayName,
                'role'         => $role,
                'joined_at'    => now(),
            ]);
        }

        Redis::hset("dawdle:guest:{$guestId}", 'displayName', $displayName, 'roomId', $room->id, 'role', $role);
        Redis::expire("dawdle:guest:{$guestId}", 86400);

        if ($role === 'player') {
            Redis::sadd("dawdle:room:{$room->id}:players", $guestId);
        }

        broadcast(new PlayerJoined($room->id, $guestId, $displayName, $role))->toOthers();

        return [
            'roomId' => $room->id,
            'code'   => $room->code,
            'role'   => $role,
        ];
    }

    public function sendChat(string $code, string $guestId, string $message): void
    {
        $roomId = Room::where('code', $code)->value('id');
        if (!$roomId) {
            throw new \Illuminate\Database\Eloquent\ModelNotFoundException();
        }

        $guest = Redis::hgetall("dawdle:guest:{$guestId}");
        if (empty($guest) || ($guest['roomId'] ?? null) !== $roomId) {
            throw new \InvalidArgumentException('Guest is not a member of this room');
        }

        $displayName = $guest['displayName'] ?? 'Guest';

        broadcast(new ChatMessageSent(
            $roomId,
            $guestId,
            $displayName,
            $message,
            now()->toISOString(),
        ))->toOthers();
    }

    public function leave(string $code, string $guestId): void
    {
        $roomId = Room::where('code', $code)->value('id');
        if (!$roomId) return;

        $displayName = Redis::hget("dawdle:guest:{$guestId}", 'displayName') ?? 'Guest';
        RoomGuest::where('room_id', $roomId)->where('guest_id', $guestId)->update(['left_at' => now()]);
        Redis::hdel("dawdle:guest:{$guestId}", 'roomId', 'role');
        Redis::srem("dawdle:room:{$roomId}:players", $guestId);
        Redis::srem("dawdle:room:{$roomId}:ready", $guestId);
        broadcast(new PlayerLeft($roomId, $guestId, $displayName));
    }

    public function toggleReady(string $code, string $guestId): array
    {
        $roomId = Room::where('code', $code)->value('id');
        if (!$roomId) {
            throw new \Illuminate\Database\Eloquent\ModelNotFoundException();
        }

        $key = "dawdle:room:{$roomId}:ready";
        $alreadyReady = Redis::sismember($key, $guestId);

        if ($alreadyReady) {
            Redis::srem($key, $guestId);
            $ready = false;
        } else {
            Redis::sadd($key, $guestId);
            $ready = true;
        }

        broadcast(new PlayerReady($roomId, $guestId, $ready))->toOthers();

        $playersKey = "dawdle:room:{$roomId}:players";
        $allPlayers = Redis::smembers($playersKey);
        $readyPlayers = Redis::smembers($key);

        if (count($allPlayers) >= 2 && count($allPlayers) === count($readyPlayers)) {
            return ['ready' => $ready, 'shouldStart' => true, 'roomId' => $roomId, 'players' => $allPlayers];
        }

        return ['ready' => $ready, 'shouldStart' => false];
    }

    public function setStatus(string $roomId, string $status): void
    {
        Redis::hset("dawdle:room:{$roomId}", 'status', $status);
        Room::where('id', $roomId)->update(['status' => $status]);
    }

    public function selectGame(string $code, string $guestId, string $gameType): void
    {
        $room = Room::where('code', $code)->firstOrFail();

        if ($room->host_guest_id !== $guestId) {
            throw new \InvalidArgumentException('Only the host can select the game');
        }

        if (!in_array($gameType, ['tic_tac_toe', 'pictionary', 'spotto'], true)) {
            throw new \InvalidArgumentException('Invalid game type');
        }

        Redis::hset("dawdle:room:{$room->id}", 'selectedGame', $gameType);
        broadcast(new \Modules\Room\Events\GameSelected($room->id, $gameType));
    }
}
