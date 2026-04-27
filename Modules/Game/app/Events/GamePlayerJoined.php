<?php

namespace Modules\Game\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class GamePlayerJoined implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public string $guestId,
        public string $displayName,
        public array $players,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'game.player_joined';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId' => $this->gameId,
            'guestId' => $this->guestId,
            'displayName' => $this->displayName,
            'players' => $this->players,
        ];
    }
}
