<?php

namespace App\Policies;

use App\Models\Conversation;
use App\Models\User;

class ConversationPolicy
{
    /** Only the owner may use a conversation's bridge endpoint (spec §12.2). */
    public function view(User $user, Conversation $conversation): bool
    {
        return (string) $conversation->user_id === (string) $user->getKey();
    }
}
