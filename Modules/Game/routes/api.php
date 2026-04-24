<?php

use Illuminate\Support\Facades\Route;
use Modules\Game\Http\Controllers\GameController;

Route::middleware(['guest.id'])->prefix('v1')->group(function () {
    Route::post('games/{gameId}/move', [GameController::class, 'move']);
    Route::post('games/{gameId}/join', [GameController::class, 'join']);
    Route::get('games/{gameId}/state', [GameController::class, 'state']);
    Route::get('games/{gameId}/word', [GameController::class, 'word']);
});
