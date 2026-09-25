<?php

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

// Laravel reference §2 (MUST: private, per user and conversation).
Broadcast::channel('toolmark.{userId}.{conversationId}', function (User $user, string $userId, string $conversationId): bool {
    // Route parameters are strings: compare as strings, never loosely and never int === string.
    return (string) $user->getKey() === $userId
        && Conversation::whereKey($conversationId)->where('user_id', $user->getKey())->exists();
});
