<?php

namespace App\Http\Controllers\Testing;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/** `local`/`testing` only: signs in as a seeded user and redirects to `?next=` (a same-site path). */
final class LoginController
{
    public function __invoke(Request $request, User $user): RedirectResponse
    {
        Auth::login($user);
        $request->session()->regenerate();

        $next = $request->query('next');
        $safe = is_string($next) && str_starts_with($next, '/') && ! str_starts_with($next, '//')
            && ! str_contains($next, '\\');

        return redirect($safe ? $next : '/');
    }
}
