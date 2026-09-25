<?php

namespace Tests\Feature;

use Illuminate\Foundation\Vite;
use Tests\TestCase;

/**
 * The e2e bundle (with the test hook) is built into `public/build-e2e`, never `public/build`. The
 * app serves it only when TOOLMARK_E2E_BUILD is set and the environment is `local` or `testing`.
 */
final class E2eBuildDirectoryTest extends TestCase
{
    public function test_uses_the_e2e_build_only_when_asked_in_local_or_testing(): void
    {
        $this->assertSame('build', $this->buildDirectory());
        foreach (['testing', 'local'] as $env) {
            $this->withEnvironment($env, fn () => $this->assertSame('build-e2e', $this->buildDirectory(), $env), [
                'TOOLMARK_E2E_BUILD' => 'true',
            ]);
        }
        $this->withEnvironment('production', fn () => $this->assertSame('build', $this->buildDirectory()), [
            'TOOLMARK_E2E_BUILD' => 'true',
        ]);
    }

    private function buildDirectory(): string
    {
        return (new \ReflectionProperty(Vite::class, 'buildDirectory'))->getValue($this->app->make(Vite::class));
    }
}
