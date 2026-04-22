<?php

use Illuminate\Support\Facades\Route;
use Modules\Room\Http\Controllers\GuestController;
use Modules\Room\Http\Controllers\RoomController;

Route::middleware(['guest.id'])->prefix('v1')->group(function () {
    Route::patch('guests/display-name', [GuestController::class, 'updateDisplayName']);
    Route::post('rooms', [RoomController::class, 'store']);
    Route::get('rooms/{code}', [RoomController::class, 'show']);
    Route::post('rooms/{code}/join', [RoomController::class, 'join']);
    Route::delete('rooms/{code}/leave', [RoomController::class, 'leave']);
    Route::post('rooms/{code}/chat', [RoomController::class, 'chat']);
    Route::post('rooms/{code}/ready', [RoomController::class, 'ready']);
    Route::patch('rooms/{code}/game', [RoomController::class, 'selectGame']);
});
