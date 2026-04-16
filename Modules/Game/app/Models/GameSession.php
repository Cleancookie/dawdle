<?php

namespace Modules\Game\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GameSession extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = ['room_id', 'game_type', 'status', 'started_at', 'ended_at', 'winner_guest_id'];

    protected $casts = [
        'started_at' => 'datetime',
        'ended_at'   => 'datetime',
    ];

    public function results(): HasMany
    {
        return $this->hasMany(GameResult::class);
    }
}
