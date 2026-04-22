<?php

namespace Modules\Room\Http\Controllers;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;

class GuestController extends Controller
{
    public function updateDisplayName(Request $request): JsonResponse
    {
        $request->validate(['display_name' => 'required|string|min:1|max:32']);

        $guestId     = $request->header('X-Guest-ID');
        $displayName = $request->input('display_name');

        Redis::hset("dawdle:guest:{$guestId}", 'displayName', $displayName);

        return response()->json(['displayName' => $displayName]);
    }
}
