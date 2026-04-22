<?php

namespace Modules\Room\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

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
        $labels = ['tic_tac_toe' => 'Tic Tac Toe', 'pictionary' => 'Pictionary', 'spotto' => 'Spotto'];
        $label = $labels[$this->gameType] ?? $this->gameType;
        return [
            'gameId'        => $this->gameId,
            'gameType'      => $this->gameType,
            'players'       => $this->players,
            'firstTurn'     => $this->firstTurn,
            'systemMessage' => "Game starting — {$label}!",
        ];
    }
}
