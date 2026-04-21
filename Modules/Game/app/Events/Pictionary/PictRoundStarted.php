<?php

namespace Modules\Game\Events\Pictionary;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PictRoundStarted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public int $round,
        public int $totalRounds,
        public string $drawerGuestId,
        public string $drawerDisplayName,
        public int $timeLimit,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'pict.round_started';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId'        => $this->gameId,
            'round'         => $this->round,
            'totalRounds'   => $this->totalRounds,
            'drawerGuestId' => $this->drawerGuestId,
            'timeLimit'     => $this->timeLimit,
            'systemMessage' => "Round {$this->round}: {$this->drawerDisplayName} is drawing!",
        ];
    }
}
