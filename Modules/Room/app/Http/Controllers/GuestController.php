<?php

namespace Modules\Room\Http\Controllers;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Modules\Room\Events\PlayerUpdated;
use Modules\Room\Models\RoomGuest;

class GuestController extends Controller
{
    public function updateDisplayName(Request $request): JsonResponse
    {
        $request->validate(['display_name' => 'required|string|min:1|max:32']);

        $guestId = $request->header('X-Guest-ID');
        $displayName = $request->input('display_name');

        Redis::hset("dawdle:guest:{$guestId}", 'displayName', $displayName);

        $roomId = Redis::hget("dawdle:guest:{$guestId}", 'roomId');
        if ($roomId) {
            RoomGuest::where('room_id', $roomId)
                ->where('guest_id', $guestId)
                ->whereNull('left_at')
                ->update(['display_name' => $displayName]);

            broadcast(new PlayerUpdated($roomId, $guestId, $displayName))->toOthers();
        }

        return response()->json(['displayName' => $displayName]);
    }
}
