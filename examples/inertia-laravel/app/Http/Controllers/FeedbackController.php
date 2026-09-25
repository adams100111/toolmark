<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/** A plain Inertia `<Form>` page (uncontrolled; covered by `inertiaFormComponentAdapter`). */
final class FeedbackController
{
    public const TOPICS = ['bug', 'idea', 'question'];

    public function show(): Response
    {
        return Inertia::render('feedback', ['topics' => self::TOPICS]);
    }

    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'topic' => ['required', Rule::in(self::TOPICS)],
            'message' => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        return to_route('feedback.show')->with('status', 'Thanks for your feedback.');
    }
}
