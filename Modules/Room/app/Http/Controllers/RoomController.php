<?php

namespace Modules\Room\Http\Controllers;

use App\Http\Controllers\Controller;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Room\Services\RoomService;

class RoomController extends Controller
{
    public function __construct(private RoomService $roomService) {}

    public function store(Request $request): JsonResponse
    {
        $request->validate(['display_name' => 'required|string|min:1|max:32']);
        $guestId = $request->header('X-Guest-ID');
        $displayName = $request->input('display_name');

        return response()->json($this->roomService->create($guestId, $displayName), 201);
    }

    public function show(Request $request, string $code): JsonResponse
    {
        $room = $this->roomService->get($code);

        if ($room === null) {
            return response()->json(['error' => 'Room not found'], 404);
        }

        return response()->json($room);
    }

    public function join(Request $request, string $code): JsonResponse
    {
        $request->validate(['display_name' => 'required|string|min:1|max:32']);
        $guestId = $request->header('X-Guest-ID');
        $displayName = $request->input('display_name');

        try {
            $result = $this->roomService->join($code, $guestId, $displayName);
        } catch (ModelNotFoundException) {
            return response()->json(['error' => 'Room not found'], 404);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json($result);
    }

    public function leave(Request $request, string $code): JsonResponse
    {
        $guestId = $request->header('X-Guest-ID');
        $this->roomService->leave($code, $guestId);
        return response()->json(['ok' => true]);
    }
}
