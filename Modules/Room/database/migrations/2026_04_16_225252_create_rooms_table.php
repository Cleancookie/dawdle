<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rooms', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('code', 6)->unique();
            $table->enum('status', ['waiting', 'playing', 'round_end', 'closed'])->default('waiting');
            $table->string('host_guest_id', 36);
            $table->timestamps();
            $table->timestamp('closed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rooms');
    }
};
