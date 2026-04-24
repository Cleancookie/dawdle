<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE game_sessions MODIFY COLUMN game_type ENUM('tic_tac_toe','pictionary','spotto','pack','board') NOT NULL");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE game_sessions MODIFY COLUMN game_type ENUM('tic_tac_toe','pictionary','spotto','pack') NOT NULL");
    }
};
