<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Alice and Bob (password `password`), one conversation each, three challenges for Alice.
 * Demo data with a well-known password: `local` and `testing` only.
 */
class ToolmarkDemoSeeder extends Seeder
{
    public function run(): void
    {
        self::ensureDemoEnvironment();

        $alice = User::create(['name' => 'Alice', 'email' => 'alice@example.test', 'password' => 'password']);
        $bob = User::create(['name' => 'Bob', 'email' => 'bob@example.test', 'password' => 'password']);

        $alice->conversations()->create(['title' => 'Alice and the assistant']);
        $bob->conversations()->create(['title' => 'Bob and the assistant']);

        foreach ([
            ['Robotics sprint', 'سباق الروبوتات', 'hackathon', '2026-10-05'],
            ['Design thinking', 'التفكير التصميمي', 'workshop', '2026-10-12'],
            ['Data cup', 'كأس البيانات', 'competition', '2026-11-02'],
        ] as [$en, $ar, $type, $startsAt]) {
            $alice->challenges()->create(['title_en' => $en, 'title_ar' => $ar, 'type' => $type, 'starts_at' => $startsAt]);
        }
    }

    /** Throws outside `local`/`testing`, before anything is written. */
    public static function ensureDemoEnvironment(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new \RuntimeException(sprintf(
                'Refusing to seed the Toolmark demo users (well-known password) in the "%s" environment: '
                .'they are seeded only in the local and testing environments.',
                app()->environment(),
            ));
        }
    }
}
