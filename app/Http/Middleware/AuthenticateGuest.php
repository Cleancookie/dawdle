<?php

namespace App\Http\Middleware;

use App\Auth\GuestUser;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthenticateGuest
{
    public function handle(Request $request, Closure $next): mixed
    {
        $guestId = $request->header('X-Guest-ID');

        if ($guestId && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $guestId)) {
            Auth::setUser(new GuestUser($guestId));
        }

        return $next($request);
    }
}
