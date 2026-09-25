<?php

namespace App\Http\Controllers\Testing;

use App\Models\AgentTurn;
use App\Models\Conversation;
use App\Toolmark\BrowserBridge;
use App\Toolmark\PageCallTool;
use App\Toolmark\PageDescribeTool;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * `local`/`testing` only: a scripted agent (no LLM). Runs each step through the Laravel
 * reference's `PageCallTool`/`PageDescribeTool`, i.e. as protocol v1 messages on the
 * conversation's private channel, and returns the page's results.
 */
final class ScriptedAgentController
{
    /** How long to wait for the page (its manifest, or a tool it registers after a navigation). */
    private const PAGE_WAIT_MS = 10_000;

    public function __invoke(Request $request, BrowserBridge $bridge): JsonResponse
    {
        $request->validate([
            'conversationId' => ['required', 'string', 'max:64'],
            'clientId' => ['required', 'string', 'max:128'],
            'steps' => ['required', 'array', 'min:1', 'max:20'],
            'steps.*.type' => ['required', Rule::in(['call', 'describe'])],
            'steps.*.tool' => ['required', 'string', 'max:128'],
            'steps.*.input' => ['sometimes', 'array'], // a JSON object (`{}` decodes to [])
        ]);
        $conversation = Conversation::whereKey($request->string('conversationId')->toString())
            ->where('user_id', $request->user()->getKey())
            ->firstOrFail();
        // Decoded again as objects: `{}` inputs must stay objects on the wire.
        $body = json_decode($request->getContent(), false, 64, JSON_THROW_ON_ERROR);
        $clientId = $request->string('clientId')->toString();

        $results = [];
        foreach ($body->steps as $step) {
            if (! $this->awaitPage($bridge, $conversation, $clientId, (string) $step->tool)) {
                return response()->json(['message' => 'The page is not connected'], 409);
            }
            $toolUseId = 'toolu_scripted_'.Str::random(20);
            if ($step->type === 'describe') {
                $results[] = (new PageDescribeTool($bridge, $conversation))->handle(['tool' => $step->tool], $toolUseId);

                continue;
            }
            $tool = new PageCallTool($bridge, $conversation);
            $tool->description(); // renders the manifest the "model" sees; handle() sends its rev
            $results[] = $tool->handle(['tool' => $step->tool, 'input' => $step->input ?? new \stdClass], $toolUseId);
        }

        return response()->json(['calls' => count($results), 'results' => $results]);
    }

    /** The conversation's messages, for assertions. */
    public function turns(Conversation $conversation): JsonResponse
    {
        return response()->json($conversation->messages()->orderBy('id')->get()->map(fn (AgentTurn $t): array => [
            'role' => $t->role,
            'content' => $t->content,
            'meta' => $t->meta,
            'tools' => $t->tools,
        ]));
    }

    /**
     * Waits until page `$clientId` is the conversation's connected page and lists `$tool` (a
     * navigation's new page registers its tools a moment later). False when the page never
     * connects; a tool that never appears is still sent (the page answers `unknown_tool`).
     */
    private function awaitPage(BrowserBridge $bridge, Conversation $conversation, string $clientId, string $tool): bool
    {
        $until = microtime(true) + self::PAGE_WAIT_MS / 1000;
        do {
            $page = $bridge->manifest($conversation);
            if ($page !== null && $page['clientId'] === $clientId
                && in_array($tool, array_column($page['tools'], 'name'), true)) {
                return true;
            }
            usleep(100_000);
        } while (microtime(true) < $until);

        return ($bridge->manifest($conversation)['clientId'] ?? null) === $clientId;
    }
}
