<?php

namespace Modules\Spotto\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SpottoRoundStarted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public int $round,
        public int $totalRounds,
        public array $centerCard,
        public array $playerCards,
        public array $symbols,
        public array $centerLayout = [],
        public array $playerLayouts = [],
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.'.$this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'spotto.round_started';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId' => $this->gameId,
            'round' => $this->round,
            'totalRounds' => $this->totalRounds,
            'centerCard' => $this->centerCard,
            'playerCards' => $this->playerCards,
            'symbols' => $this->symbols,
            'centerLayout' => $this->centerLayout,
            'playerLayouts' => $this->playerLayouts,
            'systemMessage' => "Round {$this->round} of {$this->totalRounds} — find the match!",
        ];
    }
}
