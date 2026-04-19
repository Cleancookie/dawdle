<?php

namespace Modules\Room\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PlayerJoined implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $guestId,
        public string $displayName,
        public string $role,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.' . $this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'room.player_joined';
    }

    public function broadcastWith(): array
    {
        return [
            'guestId'       => $this->guestId,
            'displayName'   => $this->displayName,
            'role'          => $this->role,
            'systemMessage' => "{$this->displayName} joined the room",
        ];
    }
}
