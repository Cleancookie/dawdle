<?php

namespace Modules\Game\Services\Pictionary;

class GameLogic
{
    private const WORDS = [
        'apple', 'banana', 'bridge', 'castle', 'cloud',
        'diamond', 'elephant', 'flower', 'guitar', 'hammer',
        'island', 'jungle', 'kettle', 'ladder', 'mountain',
        'needle', 'ocean', 'penguin', 'rainbow', 'rocket',
        'scissors', 'telescope', 'umbrella', 'volcano', 'waterfall',
        'xylophone', 'yacht', 'zebra',
    ];

    public static function initialState(string $gameId, string $roomId, array $playerIds): array
    {
        shuffle($playerIds);

        $scores = [];
        foreach ($playerIds as $id) {
            $scores[$id] = 0;
        }

        return [
            'gameId' => $gameId,
            'roomId' => $roomId,
            'gameType' => 'pictionary',
            'round' => 1,
            'totalRounds' => count($playerIds),
            'playerOrder' => $playerIds,
            'currentDrawer' => $playerIds[0],
            'word' => self::pickWord(),
            'status' => 'playing',
            'scores' => $scores,
            'guessedCorrect' => [],
            'timeLimit' => 60,
        ];
    }

    public static function applyGuess(array $state, string $guestId, string $guess): array
    {
        if ($guestId === $state['currentDrawer']) {
            $state['result'] = 'drawer';

            return $state;
        }

        if (in_array($guestId, $state['guessedCorrect'], true)) {
            $state['result'] = 'already_guessed';

            return $state;
        }

        if (strtolower(trim($guess)) !== strtolower($state['word'])) {
            $state['result'] = 'wrong';

            return $state;
        }

        // Correct guess
        $alreadyGuessed = count($state['guessedCorrect']);
        $guesserPoints = $alreadyGuessed === 0 ? 100 : 50;

        $state['scores'][$guestId] = ($state['scores'][$guestId] ?? 0) + $guesserPoints;
        $state['scores'][$state['currentDrawer']] = ($state['scores'][$state['currentDrawer']] ?? 0) + 20;
        $state['guessedCorrect'][] = $guestId;
        $state['result'] = 'correct';

        return $state;
    }

    public static function advanceRound(array $state): array
    {
        $state['guessedCorrect'] = [];
        $state['round']++;

        if ($state['round'] > $state['totalRounds']) {
            $state['status'] = 'finished';

            return $state;
        }

        // Rotate drawer to next player in order
        $order = $state['playerOrder'];
        $current = array_search($state['currentDrawer'], $order, true);
        $nextIndex = ($current + 1) % count($order);

        $state['currentDrawer'] = $order[$nextIndex];
        $state['word'] = self::pickWord();

        return $state;
    }

    private static function pickWord(): string
    {
        return self::WORDS[array_rand(self::WORDS)];
    }
}
