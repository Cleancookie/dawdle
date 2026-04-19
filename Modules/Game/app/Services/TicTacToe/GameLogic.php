<?php

namespace Modules\Game\Services\TicTacToe;

class GameLogic
{
    private const WIN_LINES = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6],             // diagonals
    ];

    public static function initialState(string $gameId, string $roomId, string $playerX, string $playerO): array
    {
        return [
            'gameId'      => $gameId,
            'roomId'      => $roomId,
            'gameType'    => 'tic_tac_toe',
            'board'       => array_fill(0, 9, null),
            'players'     => ['X' => $playerX, 'O' => $playerO],
            'currentTurn' => $playerX,
            'status'      => 'playing',
            'winner'      => null,
        ];
    }

    public static function applyMove(array $state, string $guestId, int $index): array
    {
        if ($state['status'] !== 'playing') {
            throw new \InvalidArgumentException('Game is not in progress.');
        }

        if ($guestId !== $state['currentTurn']) {
            throw new \InvalidArgumentException('It is not this player\'s turn.');
        }

        if ($index < 0 || $index > 8) {
            throw new \InvalidArgumentException('Cell index must be between 0 and 8.');
        }

        if ($state['board'][$index] !== null) {
            throw new \InvalidArgumentException('Cell is already taken.');
        }

        $symbol = $state['players']['X'] === $guestId ? 'X' : 'O';
        $state['board'][$index] = $symbol;

        if (self::checkWin($state['board'], $symbol)) {
            $state['status'] = 'finished';
            $state['winner'] = $guestId;
        } elseif (self::isDraw($state['board'])) {
            $state['status'] = 'finished';
            $state['winner'] = null;
        } else {
            $state['currentTurn'] = $state['players']['X'] === $guestId
                ? $state['players']['O']
                : $state['players']['X'];
        }

        return $state;
    }

    public static function checkWin(array $board, string $symbol): bool
    {
        foreach (self::WIN_LINES as [$a, $b, $c]) {
            if ($board[$a] === $symbol && $board[$b] === $symbol && $board[$c] === $symbol) {
                return true;
            }
        }

        return false;
    }

    public static function isDraw(array $board): bool
    {
        return !in_array(null, $board, true);
    }
}
