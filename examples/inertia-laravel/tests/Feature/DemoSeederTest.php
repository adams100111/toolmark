<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\ToolmarkDemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The demo users have a well-known password: seeding them is `local`/`testing` only. */
final class DemoSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_seeder_runs_in_testing(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertSame(['alice@example.test', 'bob@example.test'], User::orderBy('email')->pluck('email')->all());
    }

    public function test_demo_seeder_refuses_to_run_in_production(): void
    {
        $this->withEnvironment('production', function (): void {
            $this->assertSame('production', $this->app->environment());
            foreach ([ToolmarkDemoSeeder::class, DatabaseSeeder::class] as $seeder) {
                try {
                    $this->app->make($seeder)->setContainer($this->app)->__invoke();
                    $this->fail("{$seeder} ran in production");
                } catch (\RuntimeException $e) {
                    $this->assertStringContainsString('only in the local and testing environments', $e->getMessage());
                }
            }
        });
    }

    public function test_demo_seeder_refuses_to_run_in_staging(): void
    {
        $this->withEnvironment('staging', function (): void {
            // (A missing table would also throw a RuntimeException: assert the guard's own message.)
            $this->expectExceptionMessage('only in the local and testing environments');
            $this->app->make(ToolmarkDemoSeeder::class)->setContainer($this->app)->__invoke();
        });
    }
}
