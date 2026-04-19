<?php

namespace App\Auth;

use Illuminate\Contracts\Auth\Authenticatable;

class GuestUser implements Authenticatable
{
    public function __construct(public readonly string $guestId) {}

    public function getAuthIdentifierName(): string { return 'guestId'; }
    public function getAuthIdentifier(): mixed { return $this->guestId; }
    public function getAuthPasswordName(): string { return ''; }
    public function getAuthPassword(): string { return ''; }
    public function getRememberToken(): ?string { return null; }
    public function setRememberToken($value): void {}
    public function getRememberTokenName(): string { return ''; }
}
