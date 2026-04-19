<?php

namespace Modules\Game\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TttMoveMade implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public int $index,
        public string $symbol,
        public ?string $nextTurn,
        public string $status,
        public ?string $winner,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.' . $this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'ttt.move_made';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId'   => $this->gameId,
            'index'    => $this->index,
            'symbol'   => $this->symbol,
            'nextTurn' => $this->nextTurn,
            'status'   => $this->status,
            'winner'   => $this->winner,
        ];
    }
}
