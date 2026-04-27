<?php

namespace Modules\Room\Providers;

use Illuminate\Console\Scheduling\Schedule;
use Modules\Room\Console\Commands\PruneEmptyRooms;
use Nwidart\Modules\Support\ModuleServiceProvider;

class RoomServiceProvider extends ModuleServiceProvider
{
    /**
     * The name of the module.
     */
    protected string $name = 'Room';

    /**
     * The lowercase version of the module name.
     */
    protected string $nameLower = 'room';

    /**
     * Command classes to register.
     *
     * @var string[]
     */
    protected array $commands = [PruneEmptyRooms::class];

    /**
     * Provider classes to register.
     *
     * @var string[]
     */
    protected array $providers = [
        EventServiceProvider::class,
        RouteServiceProvider::class,
    ];

    /**
     * Define module schedules.
     *
     * @param  $schedule
     */
    protected function configureSchedules(Schedule $schedule): void
    {
        $schedule->command('room:prune')->everyFiveMinutes();
    }
}
