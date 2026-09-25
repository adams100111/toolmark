<?php

namespace App\Http\Controllers\Testing;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/** `local`/`testing` only: signs in as a seeded user and redirects to `?next=` (a same-host path). */
final class LoginController
{
    public function __invoke(Request $request, User $user): RedirectResponse
    {
        Auth::login($user);
        $request->session()->regenerate();

        $next = $request->query('next');

        return redirect(is_string($next) && self::isSameHostPath($next, $request->getHost()) ? $next : '/');
    }

    /**
     * A path on this host only: no control characters (browsers drop a tab or newline, turning
     * `/\t/evil.example` into `//evil.example`), no scheme-relative `//` or backslash, and the URL
     * it resolves to has this request's host.
     */
    private static function isSameHostPath(string $next, string $host): bool
    {
        if (preg_match('/[\x00-\x1F\x7F]/', $next) === 1
            || ! str_starts_with($next, '/') || str_starts_with($next, '//') || str_contains($next, '\\')) {
            return false;
        }
        $parts = parse_url($next);
        if ($parts === false || isset($parts['scheme']) || isset($parts['host']) || isset($parts['user'])) {
            return false;
        }

        return parse_url(url($next), PHP_URL_HOST) === $host;
    }
}
