<?php

namespace App\Providers;

use App\Agent\ScriptedAgentRunner;
use App\Toolmark\AgentRunner;
use Illuminate\Support\Facades\Vite;
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
        // The Playwright run builds the frontend with the test hook into public/build-e2e (never
        // public/build) and starts the server with TOOLMARK_E2E_BUILD=true.
        if (config('toolmark.e2e_build') && $this->app->environment(['local', 'testing'])) {
            Vite::useBuildDirectory('build-e2e');
        }
    }
}
