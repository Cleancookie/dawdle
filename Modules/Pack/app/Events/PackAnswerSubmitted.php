<?php

namespace Modules\Pack\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PackAnswerSubmitted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public string $guestId,
        public int $answeredCount,
        public int $totalCount,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'pack.answer_submitted';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId' => $this->gameId,
            'guestId' => $this->guestId,
            'answeredCount' => $this->answeredCount,
            'totalCount' => $this->totalCount,
            'systemMessage' => "{$this->answeredCount}/{$this->totalCount} answered",
        ];
    }
}
