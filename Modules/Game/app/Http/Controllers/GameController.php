<?php

namespace Modules\Game\Http\Controllers;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Game\Services\GameService;

class GameController extends Controller
{
    public function __construct(private GameService $gameService) {}

    public function move(Request $request, string $gameId): JsonResponse
    {
        $validated = $request->validate(['index' => 'required|integer|min:0|max:8']);
        $guestId = $request->header('X-Guest-ID');

        try {
            $state = $this->gameService->applyMove($gameId, $guestId, $validated);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 404);
        }

        return response()->json($state);
    }

    public function state(Request $request, string $gameId): JsonResponse
    {
        $state = $this->gameService->getState($gameId);

        if ($state === null) {
            return response()->json(['error' => 'Game not found'], 404);
        }

        return response()->json($state);
    }
}
