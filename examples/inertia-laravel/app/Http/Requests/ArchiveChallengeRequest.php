<?php

namespace App\Http\Requests;

use App\Models\Challenge;
use Illuminate\Foundation\Http\FormRequest;

final class ArchiveChallengeRequest extends FormRequest
{
    private ?Challenge $challenge = null;

    public function authorize(): bool
    {
        // MUST: re-authorize every visit for the specific challenge (the route's `can` only checks
        // that the user may archive anything).
        $id = $this->input('challenge');
        $this->challenge = is_int($id) || (is_string($id) && ctype_digit($id)) ? Challenge::find((int) $id) : null;

        return $this->challenge !== null && ($this->user()?->can('archive', $this->challenge) ?? false);
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['challenge' => ['required', 'integer']];
    }

    public function challenge(): Challenge
    {
        return $this->challenge ?? throw new \LogicException('authorize() has not run');
    }
}
