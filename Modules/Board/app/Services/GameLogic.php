<?php

namespace Modules\Board\Services;

class GameLogic
{
    public const MIN_PLAYERS = 1;
    public const MAX_PLAYERS = 40;

    public static function initialState(string $gameId, string $roomId, array $playerIds): array
    {
        return [
            'gameType'    => 'board',
            'gameId'      => $gameId,
            'roomId'      => $roomId,
            'playerOrder' => $playerIds,
            'status'      => 'in_progress',
        ];
    }
}
