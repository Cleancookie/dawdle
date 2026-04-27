<?php

namespace Modules\Pack\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PackRoundEnded implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public string $question,
        public array $answers,
        public ?string $mostCommon,
        public array $winners,
        public array $scores,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'pack.round_ended';
    }

    public function broadcastWith(): array
    {
        $winnerCount = count($this->winners);
        if ($this->mostCommon === null) {
            $systemMessage = 'Everyone answered differently — no points!';
        } elseif ($winnerCount === 1) {
            $systemMessage = "The herd said \"{$this->mostCommon}\" — 1 player scores!";
        } else {
            $systemMessage = "The herd said \"{$this->mostCommon}\" — {$winnerCount} players score!";
        }

        return [
            'gameId' => $this->gameId,
            'question' => $this->question,
            'answers' => $this->answers,
            'mostCommon' => $this->mostCommon,
            'winners' => $this->winners,
            'scores' => $this->scores,
            'systemMessage' => $systemMessage,
        ];
    }
}
