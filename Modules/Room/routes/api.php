<?php

use Illuminate\Support\Facades\Route;
use Modules\Room\Http\Controllers\GuestController;
use Modules\Room\Http\Controllers\RoomController;

Route::get('v1/ping', function () {
    return response('', 204);
});

Route::middleware(['guest.id'])->prefix('v1')->group(function () {
    Route::patch('guests/display-name', [GuestController::class, 'updateDisplayName']);
    Route::get('rooms', [RoomController::class, 'index']);
    Route::post('rooms', [RoomController::class, 'store']);
    Route::get('rooms/{code}', [RoomController::class, 'show']);
    Route::post('rooms/{code}/join', [RoomController::class, 'join']);
    Route::delete('rooms/{code}/leave', [RoomController::class, 'leave']);
    Route::post('rooms/{code}/chat', [RoomController::class, 'chat']);
    Route::post('rooms/{code}/ready', [RoomController::class, 'ready']);
    Route::patch('rooms/{code}/game', [RoomController::class, 'selectGame']);
    Route::post('rooms/{code}/transfer-host', [RoomController::class, 'transferHost']);
    Route::patch('rooms/{code}/visibility', [RoomController::class, 'setVisibility']);
});
