<?php

namespace App\Policies;

use App\Models\Challenge;
use App\Models\User;

class ChallengePolicy
{
    /** Whether the page may offer the `challenges.archive` tool: the user owns an active challenge. */
    public function archiveAny(User $user): bool
    {
        return $user->challenges()->active()->exists();
    }

    /** Re-checked on every archive visit (the prop is a hint, not a permission). */
    public function archive(User $user, Challenge $challenge): bool
    {
        return (string) $challenge->user_id === (string) $user->getKey() && $challenge->archived_at === null;
    }
}
