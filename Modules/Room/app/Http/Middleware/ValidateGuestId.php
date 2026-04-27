<?php

namespace Modules\Room\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class ValidateGuestId
{
    public function handle(Request $request, Closure $next)
    {
        $guestId = $request->header('X-Guest-ID');

        if (! $guestId || ! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $guestId)) {
            return response()->json(['error' => 'Invalid or missing X-Guest-ID header'], 400);
        }

        return $next($request);
    }
}
