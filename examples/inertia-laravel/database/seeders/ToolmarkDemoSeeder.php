<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

/** Alice and Bob (password `password`), one conversation each, three challenges for Alice. */
class ToolmarkDemoSeeder extends Seeder
{
    public function run(): void
    {
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
}
