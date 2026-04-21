<?php

namespace Modules\Game\Events\Pictionary;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PictStroke implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public array $points,
        public string $color,
        public int $width,
        public bool $isEraser,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'pict.stroke';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId' => $this->gameId,
            'points' => $this->points,
            'color' => $this->color,
            'width' => $this->width,
            'isEraser' => $this->isEraser,
        ];
    }
}
