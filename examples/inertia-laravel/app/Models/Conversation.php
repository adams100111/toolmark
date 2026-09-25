<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A user's conversation with the agent; owns the private channel `toolmark.{user}.{id}`. */
#[Fillable(['user_id', 'title'])]
class Conversation extends Model
{
    use HasUuids;

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The conversation's messages (the Laravel reference's `messages()`), stored as agent turns.
     *
     * @return HasMany<AgentTurn, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(AgentTurn::class);
    }
}
