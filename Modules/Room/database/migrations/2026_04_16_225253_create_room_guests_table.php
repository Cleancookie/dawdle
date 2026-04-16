<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('room_guests', function (Blueprint $table) {
            $table->id();
            $table->ulid('room_id');
            $table->string('guest_id', 36);
            $table->string('display_name', 32);
            $table->enum('role', ['player', 'spectator'])->default('player');
            $table->timestamp('joined_at')->useCurrent();
            $table->timestamp('left_at')->nullable();

            $table->foreign('room_id')->references('id')->on('rooms')->onDelete('cascade');
            $table->index(['room_id', 'guest_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('room_guests');
    }
};
