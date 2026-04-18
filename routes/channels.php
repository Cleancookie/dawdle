<?php

use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Request;

Broadcast::channel('room.{roomId}', function ($user, string $roomId) {
    $guestId = Request::header('X-Guest-ID');
    if (!$guestId || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $guestId)) {
        return false;
    }

    $guest = Redis::hgetall("dawdle:guest:{$guestId}");
    if (empty($guest) || ($guest['roomId'] ?? null) !== $roomId) {
        return false;
    }

    return [
        'id'          => $guestId,
        'displayName' => $guest['displayName'] ?? 'Guest',
        'role'        => $guest['role'] ?? 'spectator',
    ];
});
