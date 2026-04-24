<?php

namespace Modules\Spotto\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SpottoHover implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public string $guestId,
        public int $symbolIdx,
        public string $cardId,   // guestId of card owner, or 'center'
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'spotto.hover';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId' => $this->gameId,
            'guestId' => $this->guestId,
            'symbolIdx' => $this->symbolIdx,
            'cardId' => $this->cardId,
            'systemMessage' => "hover: {$this->guestId} on {$this->cardId} → symbol {$this->symbolIdx}",
        ];
    }
}
