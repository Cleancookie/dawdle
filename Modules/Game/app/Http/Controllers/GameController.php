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
        $request->validate([
            'type'        => 'sometimes|string|max:64',
            'index'       => 'sometimes|integer|min:0|max:8',
            'guess'       => 'sometimes|string|max:100',
            'points'      => 'sometimes|array|max:500',
            'points.*.x'  => 'sometimes|numeric|min:-10|max:810',
            'points.*.y'  => 'sometimes|numeric|min:-10|max:510',
            'color'       => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'width'       => 'sometimes|integer|min:1|max:20',
            'isEraser'    => 'sometimes|boolean',
            'strokeId'    => 'sometimes|nullable|string|max:64',
            'final'       => 'sometimes|boolean',
            'symbolIdx'   => 'sometimes|integer|min:0|max:255',
        ]);
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
        $guestId = $request->header('X-Guest-ID');
        $state   = $this->gameService->getState($gameId);

        if ($state === null) {
            return response()->json(['error' => 'Game not found'], 404);
        }

        $roomId      = $state['roomId'] ?? null;
        $playerOrder = $state['playerOrder'] ?? array_values($state['players'] ?? []);
        $inGame      = $roomId && in_array($guestId, $playerOrder, true);

        if (!$inGame) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        // Strip word from state response — drawers must use GET /games/:id/word
        unset($state['word']);

        return response()->json($state);
    }

    public function word(Request $request, string $gameId): JsonResponse
    {
        $guestId = $request->header('X-Guest-ID');
        $state   = $this->gameService->getState($gameId);

        if ($state === null) {
            return response()->json(['error' => 'Game not found'], 404);
        }

        if (($state['gameType'] ?? '') !== 'pictionary') {
            return response()->json(['error' => 'Not a Pictionary game'], 422);
        }

        if ($state['currentDrawer'] !== $guestId) {
            return response()->json(['error' => 'Only the drawer can fetch the word'], 403);
        }

        return response()->json(['word' => $state['word']]);
    }
}
