<?php

use App\Http\Controllers\ChallengeController;
use App\Http\Controllers\FeedbackController;
use App\Http\Controllers\Testing\LoginController;
use App\Http\Controllers\Testing\ScriptedAgentController;
use App\Http\Controllers\TourPlanController;
use App\Http\Controllers\WizardController;
use App\Models\Challenge;
use App\Toolmark\BridgeController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => to_route('challenges.index'));
Route::get('/login', fn () => response('Sign in through /testing/login/{email} (local and testing only).'))->name('login');

Route::middleware('auth')->group(function () {
    Route::get('/challenges', [ChallengeController::class, 'index'])->name('challenges.index');
    Route::get('/challenges/create', [ChallengeController::class, 'create'])->name('challenges.create');
    Route::post('/challenges', [ChallengeController::class, 'store'])->name('challenges.store');
    // Server-declared tool route: re-authorized here (`can`) and per challenge in the FormRequest.
    Route::post('/challenges/archive', [ChallengeController::class, 'archive'])
        ->name('challenges.archive')
        ->can('archiveAny', Challenge::class);

    Route::get('/wizard', [WizardController::class, 'show'])->name('wizard.show');
    Route::post('/wizard', [WizardController::class, 'store'])->name('wizard.store');
    Route::get('/feedback', [FeedbackController::class, 'show'])->name('feedback.show');
    Route::post('/feedback', [FeedbackController::class, 'store'])->name('feedback.store');

    Route::post('/tour/plan', TourPlanController::class)->name('tour.plan');
});

// Laravel reference §5 (web middleware: session + CSRF via the X-XSRF-TOKEN header).
Route::post('/toolmark/bridge/{conversation}', BridgeController::class)
    ->middleware(['auth', 'can:view,conversation', 'throttle:600,1'])
    ->name('toolmark.bridge');

// Test helpers: never registered outside `local` and `testing`.
if (app()->environment('local', 'testing')) {
    Route::get('/testing/login/{user:email}', LoginController::class)->name('testing.login');
    Route::middleware('auth')->group(function () {
        Route::post('/testing/agent/script', ScriptedAgentController::class)->name('testing.agent.script');
        Route::get('/testing/agent/turns/{conversation}', [ScriptedAgentController::class, 'turns'])
            ->name('testing.agent.turns')
            ->can('view', 'conversation');
    });
}
