<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The example's tour planner (spec §11.5): a scripted server planner, no LLM. Returns fixed
 * `TourStep[]` for a goal, keeping only steps whose tool the page says it has.
 */
final class TourPlanController
{
    /** @var list<array{tool: string, param: string, title: string, text: string}> */
    private const CREATE_CHALLENGE = [
        ['tool' => 'challenges.create.fill', 'param' => 'title.en', 'title' => 'Name it', 'text' => 'Start with the English title of the challenge.'],
        ['tool' => 'challenges.create.fill', 'param' => 'title.ar', 'title' => 'Arabic title', 'text' => 'Add the Arabic title; both languages are required.'],
        ['tool' => 'challenges.create.fill', 'param' => 'startsAt', 'title' => 'Pick a date', 'text' => 'Choose the day the challenge starts.'],
    ];

    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'goal' => ['required', 'string', 'max:500'],
            'tools' => ['present', 'array', 'max:200'],
            'tools.*.name' => ['required', 'string', 'max:128'],
        ]);
        $available = array_column($data['tools'], 'name');

        $steps = preg_match('/\bchallenge\b/i', $data['goal']) === 1 ? self::CREATE_CHALLENGE : [];

        return response()->json(array_values(array_filter(
            $steps,
            fn (array $step): bool => in_array($step['tool'], $available, true),
        )));
    }
}
