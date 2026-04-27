<?php

namespace Modules\Room\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Redis;
use Modules\Room\Models\Room;

class PruneEmptyRooms extends Command
{
    protected $signature = 'room:prune';

    protected $description = 'Close rooms that have been empty for more than 5 minutes';

    public function handle(): void
    {
        $cutoff = now()->timestamp - 300;

        Room::whereIn('status', ['waiting', 'playing'])->each(function (Room $room) use ($cutoff) {
            $emptySince = Redis::get("dawdle:room:{$room->id}:empty_since");
            $redisAlive = Redis::exists("dawdle:room:{$room->id}");

            if (($emptySince !== null && (int) $emptySince <= $cutoff) || ! $redisAlive) {
                $room->update(['status' => 'closed']);
                Redis::del(
                    "dawdle:room:{$room->id}",
                    "dawdle:room:{$room->id}:players",
                    "dawdle:room:{$room->id}:ready",
                    "dawdle:room:{$room->id}:empty_since",
                );
            }
        });
    }
}
