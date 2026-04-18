<?php

namespace Modules\Room\Services;

use Illuminate\Support\Facades\Redis;
use Modules\Room\Events\ChatMessageSent;
use Modules\Room\Events\PlayerJoined;
use Modules\Room\Events\PlayerLeft;
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
            'selectedGame', '',
            'lastActivityAt', now()->toISOString(),
        );
        Redis::expire("dawdle:room:{$room->id}", 7200);

        Redis::hset("dawdle:guest:{$guestId}", 'displayName', $displayName, 'roomId', $room->id, 'role', 'player');
        Redis::expire("dawdle:guest:{$guestId}", 86400);

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

        return [
            'roomId' => $room->id,
            'code'   => $room->code,
            'status' => $room->status,
        ];
    }

    public function join(string $code, string $guestId, string $displayName): array
    {
        $room = Room::where('code', $code)->firstOrFail();

        if ($room->status === 'closed') {
            throw new \InvalidArgumentException('Room is closed');
        }

        $status = Redis::hget("dawdle:room:{$room->id}", 'status') ?? $room->status;
        $role = $status === 'waiting' ? 'player' : 'spectator';

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

        RoomGuest::where('room_id', $roomId)->where('guest_id', $guestId)->update(['left_at' => now()]);
        Redis::hdel("dawdle:guest:{$guestId}", 'roomId', 'role');
        broadcast(new PlayerLeft($roomId, $guestId));
    }
}
