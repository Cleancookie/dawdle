<?php

namespace Modules\Board\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class BoardCursorMoved implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $guestId,
        public string $displayName,
        public float  $x,
        public float  $y,
        public float  $camX,
        public float  $camY,
        public float  $camW,
        public float  $camH,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'board.cursor_moved';
    }

    public function broadcastWith(): array
    {
        return [
            'guestId'     => $this->guestId,
            'displayName' => $this->displayName,
            'x'           => $this->x,
            'y'           => $this->y,
            'camX'        => $this->camX,
            'camY'        => $this->camY,
            'camW'        => $this->camW,
            'camH'        => $this->camH,
        ];
    }
}
