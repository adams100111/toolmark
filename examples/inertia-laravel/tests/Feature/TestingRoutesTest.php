<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/** The scripted-agent and login helpers exist only in `local` and `testing`. */
final class TestingRoutesTest extends TestCase
{
    use RefreshDatabase;

    public function test_testing_routes_present_in_testing(): void
    {
        $alice = User::factory()->create(['email' => 'alice@example.test']);

        $this->assertTrue(Route::has('testing.login'));
        $this->assertTrue(Route::has('testing.agent.script'));
        $this->get('/testing/login/alice@example.test?next=/wizard')->assertRedirect('/wizard');
        $this->assertAuthenticatedAs($alice);
        // `next` is a same-site path only (no open redirect).
        $this->get('/testing/login/alice@example.test?next=//evil.example/x')->assertRedirect('/');
        // The scripted agent needs a session.
        auth()->logout();
        $this->postJson('/testing/agent/script', [])->assertUnauthorized();
    }

    public function test_testing_routes_absent_outside_local_and_testing(): void
    {
        $this->withEnvironment('production', function (): void {
            $this->assertSame('production', $this->app->environment());
            $this->assertFalse(Route::has('testing.login'));
            $this->assertFalse(Route::has('testing.agent.script'));
            $this->assertFalse(Route::has('testing.agent.turns'));
            $this->get('/testing/login/alice@example.test')->assertNotFound();
            $this->postJson('/testing/agent/script', [])->assertNotFound();
            // The rest of the app is still there.
            $this->assertTrue(Route::has('tour.plan'));
            $this->assertTrue(Route::has('toolmark.bridge'));
        });
    }

    /** Boots a fresh application under `$env`, runs `$check`, then restores the testing app. */
    private function withEnvironment(string $env, \Closure $check): void
    {
        $previous = getenv('APP_ENV');
        $set = function (string $value): void {
            putenv("APP_ENV={$value}");
            $_ENV['APP_ENV'] = $value;
            $_SERVER['APP_ENV'] = $value;
        };
        $set($env);
        try {
            $this->refreshApplication();
            $check();
        } finally {
            $set($previous === false ? 'testing' : $previous);
            $this->refreshApplication();
        }
    }
}
