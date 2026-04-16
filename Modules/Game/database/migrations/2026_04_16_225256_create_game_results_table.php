<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_results', function (Blueprint $table) {
            $table->id();
            $table->ulid('game_session_id');
            $table->string('guest_id', 36);
            $table->integer('score')->default(0);
            $table->integer('placement');

            $table->foreign('game_session_id')->references('id')->on('game_sessions')->onDelete('cascade');
            $table->index('game_session_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('game_results');
    }
};
