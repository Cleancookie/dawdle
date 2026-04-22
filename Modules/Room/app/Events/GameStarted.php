<?php

namespace Modules\Room\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Modules\Game\Enums\GameType;

class GameStarted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $roomId,
        public string $gameId,
        public string $gameType,
        public array $players,
        public ?string $firstTurn,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.' . $this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'game.started';
    }

    public function broadcastWith(): array
    {
        $label = GameType::tryFrom($this->gameType)?->label() ?? $this->gameType;
        return [
            'gameId'        => $this->gameId,
            'gameType'      => $this->gameType,
            'players'       => $this->players,
            'firstTurn'     => $this->firstTurn,
            'systemMessage' => "Game starting — {$label}!",
        ];
    }
}
