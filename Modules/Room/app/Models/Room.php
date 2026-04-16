<?php

namespace Modules\Room\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Room extends Model
{
    use HasUlids;

    protected $fillable = ['code', 'status', 'host_guest_id', 'closed_at'];

    protected $casts = ['closed_at' => 'datetime'];

    public function guests(): HasMany
    {
        return $this->hasMany(RoomGuest::class);
    }

    public function activePlayers(): HasMany
    {
        return $this->hasMany(RoomGuest::class)
            ->where('role', 'player')
            ->whereNull('left_at');
    }
}
