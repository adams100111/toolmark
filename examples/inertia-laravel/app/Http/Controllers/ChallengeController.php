<?php

namespace App\Http\Controllers;

use App\Http\Requests\ArchiveChallengeRequest;
use App\Http\Requests\StoreChallengeRequest;
use App\Models\Challenge;
use App\Toolmark\ServerTool;
use App\Toolmark\ToolmarkProps;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

final class ChallengeController
{
    public function index(Request $request): Response
    {
        $challenges = $request->user()->challenges()->orderBy('id')->get();
        $activeIds = $challenges->whereNull('archived_at')->pluck('id')->values()->all();

        return Inertia::render('challenges/index', [
            'challenges' => $challenges->map(fn (Challenge $c): array => [
                'id' => $c->getKey(),
                'titleEn' => $c->title_en,
                'titleAr' => $c->title_ar,
                'type' => $c->type,
                'startsAt' => $c->starts_at->format('Y-m-d'),
                'archived' => $c->archived_at !== null,
            ])->all(),
            // Spec §12.4: server-declared tools, filtered by the server's own authorization.
            'toolmark' => ToolmarkProps::for($request, [
                new ServerTool(
                    name: 'challenges.archive',
                    title: 'Archive challenge',
                    description: 'Archive one of the active challenges listed on this page. An archived challenge stays listed but can no longer be changed.',
                    route: 'challenges.archive',
                    routeParameters: [],
                    method: 'post',
                    inputSchema: [
                        'type' => 'object',
                        'properties' => [
                            'challenge' => [
                                'type' => 'integer',
                                'description' => 'Id of the active challenge to archive, from the list on this page.',
                                ...($activeIds !== [] ? ['enum' => $activeIds] : []),
                            ],
                        ],
                        'required' => ['challenge'],
                        'additionalProperties' => false,
                    ],
                    ability: 'archiveAny',
                    arguments: Challenge::class,
                    hints: ['destructive' => true],
                ),
            ]),
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('challenges/create', ['types' => Challenge::TYPES]);
    }

    public function store(StoreChallengeRequest $request): RedirectResponse
    {
        $data = $request->validated();
        $request->user()->challenges()->create([
            'title_en' => $data['title']['en'],
            'title_ar' => $data['title']['ar'],
            'type' => $data['type'],
            'starts_at' => $data['startsAt'],
        ]);

        return to_route('challenges.index');
    }

    public function archive(ArchiveChallengeRequest $request): RedirectResponse
    {
        $request->challenge()->forceFill(['archived_at' => now()])->save();

        return to_route('challenges.index');
    }
}
