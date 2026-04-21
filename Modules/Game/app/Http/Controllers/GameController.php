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
        $request->validate(['type' => 'sometimes|string']);
        $guestId = $request->header('X-Guest-ID');
        $moveData = $request->all();

        try {
            $state = $this->gameService->applyMove($gameId, $guestId, $moveData);
        } catch (\DomainException $e) {
            return response()->json(['error' => $e->getMessage()], 403);
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
