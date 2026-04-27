<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class DawdleInspect extends Command
{
    protected $signature = 'dawdle:inspect {type : room | game | guest} {id : Room code, game ULID, or guest UUID}';

    protected $description = 'Inspect live Dawdle state across Redis and MySQL';

    public function handle(): int
    {
        match ($this->argument('type')) {
            'room' => $this->room($this->argument('id')),
            'game' => $this->game($this->argument('id')),
            'guest' => $this->guest($this->argument('id')),
            default => $this->error('type must be: room, game, or guest'),
        };

        return self::SUCCESS;
    }

    private function room(string $code): void
    {
        $row = DB::table('rooms')->where('code', $code)->first();
        if (! $row) {
            $this->error("Room not found: {$code}");

            return;
        }

        $id = $row->id;
        $this->title("Room: {$code}  (id: {$id})");

        $this->section('DB · rooms');
        $this->dump((array) $row);

        $this->section('Redis · dawdle:room:{id}');
        $this->dump(Redis::hgetall("dawdle:room:{$id}") ?: []);

        $this->section('Redis · dawdle:room:{id}:players (set)');
        $this->line('  '.implode(', ', Redis::smembers("dawdle:room:{$id}:players") ?: ['(empty)']));

        $this->section('Redis · dawdle:room:{id}:ready (set)');
        $this->line('  '.implode(', ', Redis::smembers("dawdle:room:{$id}:ready") ?: ['(empty)']));

        $this->section('DB · room_guests');
        $this->dump(DB::table('room_guests')->where('room_id', $id)->get()->toArray());
    }

    private function game(string $id): void
    {
        $this->title("Game: {$id}");

        $this->section('Redis · dawdle:game:{id}:state');
        $raw = Redis::get("dawdle:game:{$id}:state");
        $this->dump($raw ? json_decode($raw, true) : '(not found)');

        $this->section('DB · game_sessions');
        $this->dump((array) (DB::table('game_sessions')->where('id', $id)->first() ?? '(not found)'));

        $this->section('DB · game_results');
        $this->dump(DB::table('game_results')->where('game_session_id', $id)->get()->toArray());
    }

    private function guest(string $id): void
    {
        $this->title("Guest: {$id}");
        $this->section('Redis · dawdle:guest:{id}');
        $this->dump(Redis::hgetall("dawdle:guest:{$id}") ?: ['(not found)']);
    }

    private function title(string $s): void
    {
        $this->line('');
        $this->line("<fg=cyan;options=bold>══ {$s}</>");
    }

    private function section(string $s): void
    {
        $this->line('');
        $this->line("<fg=yellow>── {$s}</>");
    }

    private function dump(mixed $data): void
    {
        $this->line(json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }
}
