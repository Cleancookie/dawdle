<?php

namespace Modules\Game\Services\Spotto;

class GameLogic
{
    // 31 visually distinct emoji — maps to the 31 symbols of the order-5 projective plane
    private const SYMBOLS = [
        '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯',
        '🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆',
        '🦅','🦉','🦇','🐝','🐛','🦋','🐌','🐞','🐜','🕷',
        '🌟',
    ];

    private const ORDER = 5; // prime p — yields p²+p+1 = 31 cards, p+1 = 6 symbols per card

    public static function initialState(string $gameId, string $roomId, array $playerIds): array
    {
        $deck          = self::generateDeck(self::ORDER);
        $shuffled      = $deck;
        shuffle($shuffled);

        $cardsPerRound = 1 + count($playerIds);
        $totalRounds   = min((int) floor(count($shuffled) / $cardsPerRound), 10);

        $scores = [];
        foreach ($playerIds as $id) {
            $scores[$id] = 0;
        }

        $state = [
            'gameType'      => 'spotto',
            'gameId'        => $gameId,
            'roomId'        => $roomId,
            'playerOrder'   => $playerIds,
            'status'        => 'in_progress',
            'round'         => 1,
            'totalRounds'   => $totalRounds,
            'deck'          => $shuffled,
            'deckIdx'       => 0,
            'centerCard'    => [],
            'playerCards'   => [],
            'scores'        => $scores,
            'roundWinner'   => null,
            'winningSymbol' => null,
            'symbols'       => self::SYMBOLS,
        ];

        return self::dealRound($state);
    }

    public static function applyGuess(array $state, string $guestId, int $symbolIdx): array
    {
        if ($state['roundWinner'] !== null) {
            throw new \DomainException('Round already won.');
        }

        if (!array_key_exists($guestId, $state['playerCards'])) {
            throw new \DomainException('Not a player in this game.');
        }

        if (!in_array($symbolIdx, $state['playerCards'][$guestId], true)) {
            throw new \DomainException('Symbol not on your card.');
        }

        if (!in_array($symbolIdx, $state['centerCard'], true)) {
            throw new \DomainException('Symbol not on the center card.');
        }

        $state['scores'][$guestId]++;
        $state['roundWinner']   = $guestId;
        $state['winningSymbol'] = $symbolIdx;

        return $state;
    }

    public static function advanceRound(array $state): array
    {
        $state['round']++;

        if ($state['round'] > $state['totalRounds']) {
            $state['status'] = 'finished';
            return $state;
        }

        return self::dealRound($state);
    }

    private static function dealRound(array $state): array
    {
        $idx                = $state['deckIdx'];
        $state['centerCard'] = $state['deck'][$idx];
        $state['playerCards'] = [];

        foreach ($state['playerOrder'] as $i => $playerId) {
            $state['playerCards'][$playerId] = $state['deck'][$idx + 1 + $i];
        }

        $state['deckIdx']       = $idx + 1 + count($state['playerOrder']);
        $state['roundWinner']   = null;
        $state['winningSymbol'] = null;

        return $state;
    }

    /**
     * Constructs a projective plane deck of order p (p must be prime).
     * Produces p²+p+1 cards with p+1 symbols each; any two cards share exactly one symbol.
     */
    private static function generateDeck(int $p): array
    {
        $deck = [];

        // Affine lines: slope m ∈ [0,p), intercept b ∈ [0,p)
        // Card = {(x, mx+b mod p) : x ∈ [0,p)} ∪ {p²+m}
        for ($m = 0; $m < $p; $m++) {
            for ($b = 0; $b < $p; $b++) {
                $card = [];
                for ($x = 0; $x < $p; $x++) {
                    $card[] = $x * $p + (($m * $x + $b) % $p);
                }
                $card[] = $p * $p + $m;
                $deck[] = $card;
            }
        }

        // Vertical lines: x = b, for each b ∈ [0,p)
        // Card = {(b, y) : y ∈ [0,p)} ∪ {p²+p}  (point at infinity)
        for ($b = 0; $b < $p; $b++) {
            $card = [];
            for ($y = 0; $y < $p; $y++) {
                $card[] = $b * $p + $y;
            }
            $card[] = $p * $p + $p;
            $deck[] = $card;
        }

        // Line at infinity: {p²+0, p²+1, ..., p²+p}
        $card = [];
        for ($i = 0; $i <= $p; $i++) {
            $card[] = $p * $p + $i;
        }
        $deck[] = $card;

        return $deck; // p²+p+1 cards, each with p+1 symbols
    }
}
