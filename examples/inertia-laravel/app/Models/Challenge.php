<?php

namespace App\Models;

use Database\Factories\ChallengeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $user_id
 * @property \Illuminate\Support\Carbon|null $archived_at
 */
#[Fillable(['title_en', 'title_ar', 'type', 'starts_at'])]
class Challenge extends Model
{
    /** @use HasFactory<ChallengeFactory> */
    use HasFactory;

    public const TYPES = ['workshop', 'hackathon', 'competition'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['starts_at' => 'date:Y-m-d', 'archived_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @param Builder<Challenge> $query */
    public function scopeActive(Builder $query): void
    {
        $query->whereNull('archived_at');
    }
}
