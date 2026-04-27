<?php

namespace Modules\Room\Providers;

use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\Route;
use Modules\Room\Http\Middleware\ValidateGuestId;

class RouteServiceProvider extends ServiceProvider
{
    protected string $name = 'Room';

    public function boot(): void
    {
        parent::boot();

        Route::aliasMiddleware('guest.id', ValidateGuestId::class);
    }

    public function map(): void
    {
        $this->mapApiRoutes();
    }

    protected function mapApiRoutes(): void
    {
        Route::middleware('api')->prefix('api')->name('api.')->group(module_path($this->name, '/routes/api.php'));
    }
}
