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
            'objects'     => [
                'obj-1' => ['id' => 'obj-1', 'type' => 'card', 'label' => 'A♠', 'color' => '#1e293b', 'x' => -160, 'y' => -60, 'holderId' => null],
                'obj-2' => ['id' => 'obj-2', 'type' => 'card', 'label' => 'K♥', 'color' => '#dc2626', 'x' =>  -80, 'y' => -60, 'holderId' => null],
                'obj-3' => ['id' => 'obj-3', 'type' => 'card', 'label' => '7♦', 'color' => '#ea580c', 'x' =>    0, 'y' => -60, 'holderId' => null],
                'obj-4' => ['id' => 'obj-4', 'type' => 'card', 'label' => '3♣', 'color' => '#15803d', 'x' =>   80, 'y' => -60, 'holderId' => null],
                'obj-5' => ['id' => 'obj-5', 'type' => 'card', 'label' => 'Q♠', 'color' => '#1e293b', 'x' =>  160, 'y' => -60, 'holderId' => null],
            ],
        ];
    }
}
