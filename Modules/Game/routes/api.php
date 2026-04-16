<?php

use Illuminate\Support\Facades\Route;
use Modules\Game\Http\Controllers\GameController;

Route::middleware(['auth:sanctum'])->prefix('v1')->group(function () {
    Route::apiResource('games', GameController::class)->names('game');
});
