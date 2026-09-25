<?php

namespace Database\Factories;

use App\Models\Challenge;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Challenge> */
class ChallengeFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title_en' => fake()->sentence(3),
            'title_ar' => 'تحدي',
            'type' => fake()->randomElement(Challenge::TYPES),
            'starts_at' => fake()->date(),
        ];
    }
}
