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
        // Control characters are rejected: browsers drop a tab or newline, so `/\t/evil.example`
        // would become the protocol-relative `//evil.example`.
        foreach ([
            '/%09/evil.example',
            '/%0A/evil.example',
            '/%0D%0A/evil.example',
            '/%00/evil.example',
            '/%7F/evil.example',
            '/wiz%09ard',
            '/%5C/evil.example',
            'http://evil.example/x',
            'https://localhost/wizard',
            '//localhost/wizard',
            'wizard',
            'javascript:alert(1)',
        ] as $next) {
            $this->get('/testing/login/alice@example.test?next='.$next)->assertRedirect('/');
        }
        $this->get('/testing/login/alice@example.test?next=/wizard%3Fstep%3D2')->assertRedirect('/wizard?step=2');
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
}
