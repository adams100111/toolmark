<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One message of a conversation: `role` user/assistant/system, the text the model sees in
 * `content`, app bookkeeping in `meta`, and for assistant turns the tool names it could call.
 *
 * @property string $role
 * @property string $content
 * @property array<string, mixed>|null $meta
 * @property list<string>|null $tools
 */
#[Fillable(['role', 'content', 'meta', 'tools'])]
class AgentTurn extends Model
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['meta' => 'array', 'tools' => 'array'];
    }

    /** @return BelongsTo<Conversation, $this> */
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }
}
