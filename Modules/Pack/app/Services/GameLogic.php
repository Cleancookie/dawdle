<?php

namespace Modules\Pack\Services;

class GameLogic
{
    public const MIN_PLAYERS = 1;

    public const MAX_PLAYERS = 8;

    private const QUESTIONS = [
        'Name a color',
        'Name an animal',
        'Name a sport',
        'Name a country in Europe',
        'Name something in a kitchen',
        'Name a musical instrument',
        'Name something you do in the morning',
        'Name a type of weather',
        'Name a planet',
        'Name a fruit',
        'Name a type of vehicle',
        'Name something cold',
        'Name a board game',
        'Name a type of music',
        'Name something you find at the beach',
        'Name a day of the week',
        'Name a famous scientist',
        'Name something that flies',
        'Name a type of shoe',
        'Name a school subject',
        'Name something red',
        'Name a TV show genre',
        'Name a card game',
        'Name something you put on toast',
        'Name a thing you find in space',
    ];

    public static function initialState(string $gameId, string $roomId, array $playerIds): array
    {
        $questions = self::QUESTIONS;
        shuffle($questions);

        $scores = [];
        foreach ($playerIds as $id) {
            $scores[$id] = 0;
        }

        $totalRounds = min(8, count($questions));

        return [
            'gameType' => 'pack',
            'gameId' => $gameId,
            'roomId' => $roomId,
            'playerOrder' => $playerIds,
            'status' => 'in_progress',
            'round' => 1,
            'totalRounds' => $totalRounds,
            'phase' => 'answering',
            'question' => $questions[0],
            'answers' => [],
            'pendingAnswers' => [],
            'scores' => $scores,
            'timeLimit' => 30,
            'shuffledQuestions' => $questions,
        ];
    }

    public static function submitAnswer(array $state, string $guestId, string $answer): array
    {
        if ($state['phase'] !== 'answering') {
            return $state;
        }

        // Normalize: trim, lowercase, remove punctuation
        $normalized = preg_replace('/[^\p{L}\p{N}\s]/u', '', strtolower(trim($answer)));
        $normalized = trim($normalized);

        $state['pendingAnswers'][$guestId] = $normalized;

        // If all players have answered, move to reveal
        if (count($state['pendingAnswers']) >= count($state['playerOrder'])) {
            $state = self::revealAnswers($state);
        }

        return $state;
    }

    public static function revealAnswers(array $state): array
    {
        $state['answers'] = $state['pendingAnswers'];
        $state['pendingAnswers'] = [];

        // Count frequencies of each normalized answer
        $frequencies = [];
        foreach ($state['answers'] as $answer) {
            $frequencies[$answer] = ($frequencies[$answer] ?? 0) + 1;
        }

        if (empty($frequencies)) {
            $state['phase'] = 'reveal';
            $state['roundResult'] = ['mostCommon' => null, 'winners' => []];

            return $state;
        }

        $maxCount = max($frequencies);

        // If all answers are unique (max frequency is 1), nobody scores
        if ($maxCount <= 1) {
            $state['phase'] = 'reveal';
            $state['roundResult'] = ['mostCommon' => null, 'winners' => []];

            return $state;
        }

        // Find all answers tied for the highest frequency
        $topAnswers = array_keys(array_filter($frequencies, fn ($count) => $count === $maxCount));

        // Award points to all players whose answer is in the top group
        $winners = [];
        foreach ($state['answers'] as $guestId => $answer) {
            if (in_array($answer, $topAnswers, true)) {
                $state['scores'][$guestId] = ($state['scores'][$guestId] ?? 0) + 1;
                $winners[] = $guestId;
            }
        }

        // Use the first top answer as the representative "most common"
        sort($topAnswers);
        $mostCommon = $topAnswers[0];

        $state['phase'] = 'reveal';
        $state['roundResult'] = [
            'mostCommon' => $mostCommon,
            'winners' => $winners,
        ];

        return $state;
    }

    public static function advanceRound(array $state): array
    {
        $state['answers'] = [];
        $state['pendingAnswers'] = [];
        $state['roundResult'] = null;
        $state['round']++;

        if ($state['round'] > $state['totalRounds']) {
            $state['status'] = 'finished';

            return $state;
        }

        // Pick next question from the shuffled list (0-indexed, round is 1-indexed)
        $questionIdx = $state['round'] - 1;
        $state['question'] = $state['shuffledQuestions'][$questionIdx];
        $state['phase'] = 'answering';

        return $state;
    }
}
