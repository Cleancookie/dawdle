<?php

namespace Modules\Game\Events\Pictionary;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PictWordHint implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $gameId,
        public string $drawerGuestId,
        public string $word,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("game.{$this->gameId}.{$this->drawerGuestId}");
    }

    public function broadcastAs(): string
    {
        return 'pict.word_hint';
    }

    public function broadcastWith(): array
    {
        return [
            'gameId' => $this->gameId,
            'word'   => $this->word,
        ];
    }
}
