<?php

namespace Modules\Room\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ChatMessageSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $guestId,
        public string $displayName,
        public string $message,
        public string $timestamp,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.' . $this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'chat.message';
    }

    public function broadcastWith(): array
    {
        return [
            'guestId'     => $this->guestId,
            'displayName' => $this->displayName,
            'message'     => $this->message,
            'timestamp'   => $this->timestamp,
        ];
    }
}
