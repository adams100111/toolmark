<?php

namespace App\Providers;

use App\Agent\ScriptedAgentRunner;
use App\Toolmark\AgentRunner;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Laravel reference §4: one bridge per process, Redis hand-off only with the Redis cache.
        $this->app->singleton(\App\Toolmark\BrowserBridge::class, fn ($app) => new \App\Toolmark\BrowserBridge(
            cache: $app['cache']->store(), // use the redis store in production so `add` is atomic across workers
            useRedis: config('database.redis.client') !== null && config('cache.default') === 'redis',
        ));
        $this->app->bind(AgentRunner::class, ScriptedAgentRunner::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
