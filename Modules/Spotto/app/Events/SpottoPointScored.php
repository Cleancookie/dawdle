<?php

namespace Modules\Spotto\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SpottoPointScored implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public string $guestId,
        public string $displayName,
        public int $symbolIdx,
        public array $scores,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'spotto.point_scored';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId' => $this->gameId,
            'guestId' => $this->guestId,
            'displayName' => $this->displayName,
            'symbolIdx' => $this->symbolIdx,
            'scores' => $this->scores,
            'systemMessage' => "{$this->displayName} found the match!",
        ];
    }
}
