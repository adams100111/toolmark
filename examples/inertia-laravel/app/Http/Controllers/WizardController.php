<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** A three-step team sign-up wizard (one `onboarding.fill` call can fill every step). */
final class WizardController
{
    public function show(): Response
    {
        return Inertia::render('wizard');
    }

    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'team' => ['required', 'array:name,size'],
            'team.name' => ['required', 'string', 'max:100'],
            'team.size' => ['required', 'integer', 'min:1', 'max:20'],
            'schedule' => ['required', 'array:startsAt,days'],
            'schedule.startsAt' => ['required', 'date_format:Y-m-d'],
            'schedule.days' => ['required', 'integer', 'min:1', 'max:14'],
            'contact' => ['required', 'array:email'],
            'contact.email' => ['required', 'email'],
        ]);

        return to_route('wizard.show')->with('status', 'Team registered.');
    }
}
