<?php

namespace Modules\Room\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class GameSelected implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public string $roomId, public string $gameType) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('room.' . $this->roomId);
    }

    public function broadcastAs(): string
    {
        return 'room.game_selected';
    }

    public function broadcastWith(): array
    {
        $labels = ['tic_tac_toe' => 'Tic Tac Toe', 'pictionary' => 'Pictionary'];
        $label = $labels[$this->gameType] ?? $this->gameType;
        return [
            'gameType'      => $this->gameType,
            'systemMessage' => "Host changed the game to {$label}",
        ];
    }
}
