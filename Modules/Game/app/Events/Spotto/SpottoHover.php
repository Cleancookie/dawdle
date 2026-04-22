<?php

namespace Modules\Game\Events\Spotto;

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
        public int    $symbolIdx,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.' . $this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'spotto.hover';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId'        => $this->gameId,
            'guestId'       => $this->guestId,
            'symbolIdx'     => $this->symbolIdx,
            'systemMessage' => "hover: {$this->guestId} → symbol {$this->symbolIdx}",
        ];
    }
}
