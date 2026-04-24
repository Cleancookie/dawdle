<?php

namespace Modules\Pack\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PackRoundStarted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public int $round,
        public int $totalRounds,
        public string $question,
        public int $timeLimit,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'pack.round_started';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId'        => $this->gameId,
            'round'         => $this->round,
            'totalRounds'   => $this->totalRounds,
            'question'      => $this->question,
            'timeLimit'     => $this->timeLimit,
            'systemMessage' => "Round {$this->round} of {$this->totalRounds} — {$this->question}",
        ];
    }
}
