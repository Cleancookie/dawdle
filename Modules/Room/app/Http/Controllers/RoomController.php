<?php

namespace Modules\Room\Http\Controllers;

use App\Http\Controllers\Controller;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Illuminate\Validation\Rule;
use Modules\Game\Enums\GameType;
use Modules\Game\Services\GameService;
use Modules\Room\Services\RoomService;

class RoomController extends Controller
{
    public function __construct(
        private RoomService $roomService,
        private GameService $gameService,
    ) {}

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

    public function chat(Request $request, string $code): JsonResponse
    {
        $request->validate(['message' => 'required|string|min:1|max:500']);
        $guestId = $request->header('X-Guest-ID');

        try {
            $this->roomService->sendChat($code, $guestId, $request->input('message'));
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return response()->json(['error' => 'Room not found'], 404);
        } catch (\InvalidArgumentException) {
            return response()->json(['error' => 'Not a member of this room'], 403);
        }

        return response()->json(['ok' => true]);
    }

    public function ready(Request $request, string $code): JsonResponse
    {
        $guestId = $request->header('X-Guest-ID');

        try {
            $result = $this->roomService->toggleReady($code, $guestId);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return response()->json(['error' => 'Room not found'], 404);
        }

        if ($result['shouldStart']) {
            $gameType = Redis::hget("dawdle:room:{$result['roomId']}", 'selectedGame') ?: 'tic_tac_toe';
            if (count($result['players']) >= $this->gameService->minPlayers($gameType)) {
                $this->gameService->startGame($result['roomId'], $result['players'], $gameType);
            }
        }

        return response()->json(['ready' => $result['ready'], 'shouldStart' => $result['shouldStart']]);
    }

    public function selectGame(Request $request, string $code): JsonResponse
    {
        $request->validate(['game_type' => ['required', Rule::enum(GameType::class)]]);
        $guestId = $request->header('X-Guest-ID');

        try {
            $this->roomService->selectGame($code, $guestId, $request->input('game_type'));
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return response()->json(['error' => 'Room not found'], 404);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 403);
        }

        return response()->json(['ok' => true]);
    }

    public function leave(Request $request, string $code): JsonResponse
    {
        $guestId = $request->header('X-Guest-ID');
        $this->roomService->leave($code, $guestId);
        return response()->json(['ok' => true]);
    }
}
