<?php

namespace Modules\Board\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class BoardObjectDragging implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $guestId,
        public string $objectId,
        public float $x,
        public float $y,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'board.object_dragging';
    }

    public function broadcastWith(): array
    {
        return [
            'guestId' => $this->guestId,
            'objectId' => $this->objectId,
            'x' => $this->x,
            'y' => $this->y,
        ];
    }
}
