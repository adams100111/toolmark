<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Demo data only: this example has no production seed.
        ToolmarkDemoSeeder::ensureDemoEnvironment();
        $this->call(ToolmarkDemoSeeder::class);
    }
}
