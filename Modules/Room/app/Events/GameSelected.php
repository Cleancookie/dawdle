<?php

namespace Modules\Room\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Modules\Game\Enums\GameType;

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
        $label = GameType::tryFrom($this->gameType)?->label() ?? $this->gameType;
        return [
            'gameType'      => $this->gameType,
            'systemMessage' => "Host changed the game to {$label}",
        ];
    }
}
