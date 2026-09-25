<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // PHP tests never need the built frontend.
        $this->withoutVite();
    }

    /**
     * Boots a fresh application under `$env` (with the extra environment variables `$vars`), runs
     * `$check`, then restores the testing app.
     *
     * @param array<string, string> $vars
     */
    protected function withEnvironment(string $env, \Closure $check, array $vars = []): void
    {
        $vars = ['APP_ENV' => $env, ...$vars];
        $previous = [];
        foreach ($vars as $name => $value) {
            $previous[$name] = getenv($name);
            $this->setEnv($name, $value);
        }
        try {
            $this->refreshApplication();
            $check();
        } finally {
            foreach ($previous as $name => $value) {
                $this->setEnv($name, $value === false ? ($name === 'APP_ENV' ? 'testing' : null) : $value);
            }
            $this->refreshApplication();
        }
    }

    private function setEnv(string $name, ?string $value): void
    {
        if ($value === null) {
            putenv($name);
            unset($_ENV[$name], $_SERVER[$name]);

            return;
        }
        putenv("{$name}={$value}");
        $_ENV[$name] = $value;
        $_SERVER[$name] = $value;
    }
}
