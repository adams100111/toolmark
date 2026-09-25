<?php

namespace App\Http\Requests;

use App\Models\Challenge;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreChallengeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'title' => ['required', 'array:en,ar'],
            'title.en' => ['required', 'string', 'max:200'],
            'title.ar' => ['required', 'string', 'max:200'],
            'type' => ['required', Rule::in(Challenge::TYPES)],
            'startsAt' => ['required', 'date_format:Y-m-d'],
        ];
    }
}
