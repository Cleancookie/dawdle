<?php

namespace Modules\Game\Enums;

enum GameType: string
{
    case TicTacToe  = 'tic_tac_toe';
    case Pictionary = 'pictionary';
    case Spotto     = 'spotto';

    public function label(): string
    {
        return match($this) {
            self::TicTacToe  => 'Tic Tac Toe',
            self::Pictionary => 'Pictionary',
            self::Spotto     => 'Spotto',
        };
    }

    /** All valid string values — for migration enums and wherever a list is needed. */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
