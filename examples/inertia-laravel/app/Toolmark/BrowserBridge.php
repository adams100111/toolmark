<?php
// file: app/Toolmark/BrowserBridge.php
namespace App\Toolmark;

use App\Models\Conversation;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

final class BrowserBridge
{
    public const PROTOCOL = 1;
    private const PREFIX = 'toolmark:';
    /** Deferred confirmations expire on the page after 600 000 ms; keep bindings a bit longer. */
    private const CONFIRM_TTL_SECONDS = 660;
    /** Manifest bounds: more tools, or longer descriptions/titles, are rejected with 422. */
    private const MAX_TOOLS = 200;
    private const MAX_DESCRIPTION_CHARS = 1024;

    public function __construct(
        private readonly Cache $cache,
        private readonly bool $useRedis = true,   // false → cache polling fallback
        private readonly int $callTimeoutMs = 30_000,
        private readonly int $pollIntervalMs = 100,
    ) {}

    // ---- agent side -------------------------------------------------------------------------

    /**
     * Runs a page tool as caller `inapp`. Returns the page's ToolResult, or
     * ['status' => 'timeout'] (server-side only) when no result arrived before the deadline.
     *
     * @param array<string, mixed>|object $input
     * @param int|null $rev the rev of the manifest the model saw (PageCallTool's rendered one)
     * @param string|null $toolUseId the LLM provider's id of the `page_call` tool use; kept in the
     *     binding so a later `confirmed` can be tied back to it
     * @return array<string, mixed>
     */
    public function call(
        Conversation $conversation,
        string $tool,
        array|object $input,
        ?int $rev = null,
        ?string $toolUseId = null,
    ): array {
        $message = ['type' => 'call', 'tool' => $tool, 'input' => $this->jsonObject($input)];
        if ($rev !== null) {
            $message['rev'] = $rev;
        }

        return $this->request($conversation, $message, $toolUseId);
    }

    /** @return array<string, mixed> The full manifest entry as `ok` data, or a refused/timeout result. */
    public function describe(Conversation $conversation, string $tool): array
    {
        return $this->request($conversation, ['type' => 'describe', 'tool' => $tool]);
    }

    /** Latest summary manifest the page sent for this conversation, or null before the first one. */
    public function manifest(Conversation $conversation): ?array
    {
        return $this->cache->get($this->pageKey($conversation));
    }

    /**
     * @param array<string, mixed> $body type/tool/input/rev without protocol, clientId and id
     * @return array<string, mixed>
     */
    private function request(Conversation $conversation, array $body, ?string $toolUseId = null): array
    {
        $page = $this->manifest($conversation);
        if ($page === null) {
            return ['status' => 'error', 'message' => 'No page is connected'];
        }

        // MUST: unguessable ids (UUID v4: 122 random bits).
        $id = (string) Str::uuid();
        $deadlineMs = $this->nowMs() + $this->callTimeoutMs;

        // MUST: bind the id to user, conversation and clientId, with its deadline, before sending.
        $this->cache->put($this->callKey($id), [
            'user_id' => (string) $conversation->user_id,
            'conversation_id' => (string) $conversation->getKey(),
            'client_id' => $page['clientId'],
            'kind' => $body['type'],
            'deadline_ms' => $deadlineMs,
            'tool_use_id' => $toolUseId,
        ], $this->ttlSeconds($this->callTimeoutMs));

        broadcast(new ToolmarkMessage((int) $conversation->user_id, (string) $conversation->getKey(), [
            'protocol' => self::PROTOCOL,
            'clientId' => $page['clientId'],
            'id' => $id,
            ...$body,
        ]));

        $result = $this->await($id, $deadlineMs);
        if ($result === null) {
            // The page may still be working: ask it to stop (it answers with its own result, which
            // is then rejected as late/duplicate).
            broadcast(new ToolmarkMessage((int) $conversation->user_id, (string) $conversation->getKey(), [
                'protocol' => self::PROTOCOL, 'type' => 'cancel', 'clientId' => $page['clientId'], 'id' => $id,
            ]));

            return ['status' => 'timeout']; // spec §12.2: server-side only
        }

        return $result;
    }

    /** Waits for the hand-off of `$id` until the deadline; returns null on timeout. */
    private function await(string $id, int $deadlineMs): ?array
    {
        while (($remainingMs = $deadlineMs - $this->nowMs()) > 0) {
            $raw = $this->useRedis
                ? $this->blockingPop($id)
                : $this->cache->pull($this->resultKey($id));
            if ($raw !== null) {
                return json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
            }
            if (! $this->useRedis) {
                usleep(min($this->pollIntervalMs, $remainingMs) * 1000);
            }
        }

        // MUST: nothing is accepted after the deadline. Claim the id for the timeout (atomic); if
        // a result claimed it first, its hand-off is at most moments away, so wait briefly for it.
        if ($this->cache->add($this->claimKey($id), 'timeout', $this->ttlSeconds(60_000))) {
            return null;
        }
        $graceUntil = $this->nowMs() + 2_000;
        do {
            $raw = $this->useRedis
                ? $this->blockingPop($id)
                : $this->cache->pull($this->resultKey($id));
            if ($raw !== null) {
                return json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
            }
            if (! $this->useRedis) {
                usleep($this->pollIntervalMs * 1000);
            }
        } while ($this->nowMs() < $graceUntil);

        return null;
    }

    private function blockingPop(string $id): ?string
    {
        // BLPOP timeouts are whole seconds on older Redis servers: wait at most 1 s per round so
        // the deadline is re-checked often (a late round is covered by the timeout claim above).
        $popped = Redis::connection()->blpop([$this->resultKey($id)], 1);

        return is_array($popped) && isset($popped[1]) ? (string) $popped[1] : null;
    }

    // ---- page side (called by BridgeController) ---------------------------------------------

    /**
     * Accepts one page→agent message from the authenticated POST endpoint. Returns an HTTP status:
     * 204 accepted, 403 binding mismatch, 404 unknown id, 409 duplicate, 410 after the deadline,
     * 422 malformed.
     *
     * @param array<string, mixed> $message Decoded JSON body (already size- and depth-bounded).
     */
    public function accept(Conversation $conversation, array $message): int
    {
        if (($message['protocol'] ?? null) !== self::PROTOCOL
            || ! is_string($message['clientId'] ?? null) || $message['clientId'] === '') {
            return 422;
        }

        return match ($message['type'] ?? null) {
            'manifest' => $this->acceptManifest($conversation, $message),
            'changed' => $this->acceptChanged($conversation, $message),
            'result' => $this->acceptResult($conversation, $message),
            'confirmed' => $this->acceptConfirmed($conversation, $message),
            default => 422,
        };
    }

    private function acceptManifest(Conversation $conversation, array $m): int
    {
        if (! is_int($m['rev'] ?? null) || $m['rev'] < 0 || ! is_array($m['tools'] ?? null)
            || ! array_is_list($m['tools'])) {
            return 422;
        }
        // MUST: the manifest is page-controlled text that ends up in the LLM prompt (PageCallTool).
        // Validate every entry's shape and bound its size before storing it; keep only known fields.
        if (count($m['tools']) > self::MAX_TOOLS) {
            return 422;
        }
        $tools = [];
        foreach ($m['tools'] as $t) {
            $tool = $this->summaryEntry($t);
            if ($tool === null) {
                return 422;
            }
            $tools[] = $tool;
        }
        // Latest manifest wins. A new clientId (full reload or another tab, D23) re-binds this
        // user's conversation to the new page: new calls go there. Calls already sent to the old
        // clientId stay bound to it (see the notes below).
        $this->cache->put($this->pageKey($conversation), [
            'clientId' => $m['clientId'],
            'rev' => $m['rev'],
            'tools' => $tools,
        ], now()->addDay());

        return 204;
    }

    /**
     * One validated `ToolManifestSummary` (docs/protocol-v1.md), reduced to the fields the server
     * renders, or null when malformed or oversized.
     *
     * @return array{name: string, llmName: string, description: string, hints: array<string, bool>, title?: string, mode?: string}|null
     */
    private function summaryEntry(mixed $t): ?array
    {
        if (! is_array($t)
            || ! is_string($t['name'] ?? null) || preg_match('/^[A-Za-z0-9_.-]{1,128}\z/', $t['name']) !== 1
            || ! is_string($t['llmName'] ?? null) || preg_match('/^[a-zA-Z0-9_-]{1,64}\z/', $t['llmName']) !== 1
            || ! is_string($t['description'] ?? null) || mb_strlen($t['description']) > self::MAX_DESCRIPTION_CHARS
            || ! is_array($t['hints'] ?? null) || ($t['hints'] !== [] && array_is_list($t['hints']))
            || (isset($t['title']) && (! is_string($t['title']) || mb_strlen($t['title']) > self::MAX_DESCRIPTION_CHARS))
            || (isset($t['mode']) && ! is_string($t['mode']))) {
            return null;
        }
        $hints = [];
        foreach (['readOnly', 'consequential', 'destructive', 'untrustedContent'] as $hint) {
            if (array_key_exists($hint, $t['hints'])) {
                if (! is_bool($t['hints'][$hint])) {
                    return null;
                }
                $hints[$hint] = $t['hints'][$hint];
            }
        }

        return [
            'name' => $t['name'],
            'llmName' => $t['llmName'],
            'description' => $t['description'],
            'hints' => $hints,
            ...(isset($t['title']) ? ['title' => $t['title']] : []),
            ...(isset($t['mode']) ? ['mode' => $t['mode']] : []),
        ];
    }

    private function acceptChanged(Conversation $conversation, array $m): int
    {
        $page = $this->manifest($conversation);
        if ($page === null || $page['clientId'] !== $m['clientId'] || ! is_int($m['rev'] ?? null)) {
            return 403;
        }
        $this->cache->put($this->pageKey($conversation), [...$page, 'rev' => $m['rev']], now()->addDay());

        return 204;
    }

    private function acceptResult(Conversation $conversation, array $m): int
    {
        $id = $m['id'] ?? null;
        $result = $m['result'] ?? null;
        if (! is_string($id) || $id === '' || ! $this->isToolResult($result)) {
            return 422;
        }

        $binding = $this->cache->get($this->callKey($id));
        if ($binding === null) {
            return 404; // MUST: reject results for unknown ids (never issued, or expired)
        }
        if ($binding['user_id'] !== (string) $conversation->user_id              // MUST: user
            || $binding['conversation_id'] !== (string) $conversation->getKey() // MUST: conversation
            || $binding['client_id'] !== $m['clientId']) {                      // MUST: clientId
            return 403;
        }
        if ($this->nowMs() > $binding['deadline_ms']) {
            return 410; // MUST: reject results after the deadline
        }
        $needsConfirmation = $result['status'] === 'needs_confirmation';
        if ($needsConfirmation && $binding['kind'] !== 'call') {
            return 422; // only a `call` can defer to a confirmation; never a `describe`
        }
        if ($needsConfirmation) {
            // MUST: bind the confirmId to user, conversation and clientId as well. `add`, never
            // `put`: a confirmId that is already bound (replayed or colliding) must not be re-bound.
            $bound = $this->cache->add($this->confirmKey($result['confirmId']), [
                'user_id' => $binding['user_id'],
                'conversation_id' => $binding['conversation_id'],
                'client_id' => $binding['client_id'],
                'call_id' => $id,
                'tool_use_id' => $binding['tool_use_id'] ?? null,
            ], self::CONFIRM_TTL_SECONDS);
            if (! $bound) {
                return 409;
            }
        }
        // MUST: single use. `add` is atomic: only the first result (or the waiter's timeout) wins.
        // The binding itself is kept until its TTL so a duplicate is reported as such (409).
        if (! $this->cache->add($this->claimKey($id), 'result', $this->ttlSeconds(60_000))) {
            if ($needsConfirmation) {
                $this->cache->forget($this->confirmKey($result['confirmId'])); // ours, just added
            }

            return 409;
        }

        $this->handOff($id, json_encode($result, JSON_THROW_ON_ERROR));

        return 204;
    }

    private function acceptConfirmed(Conversation $conversation, array $m): int
    {
        $confirmId = $m['confirmId'] ?? null;
        $result = $m['result'] ?? null;
        if (! is_string($confirmId) || $confirmId === '' || ! $this->isToolResult($result)) {
            return 422;
        }
        $binding = $this->cache->get($this->confirmKey($confirmId));
        if ($binding === null) {
            return 404; // MUST: unknown (never seen in a needs_confirmation result) or expired
        }
        if ($binding['user_id'] !== (string) $conversation->user_id
            || $binding['conversation_id'] !== (string) $conversation->getKey()
            || $binding['client_id'] !== $m['clientId']) {
            return 403;
        }
        if (! $this->cache->add($this->claimKey("confirm:{$confirmId}"), true, self::CONFIRM_TTL_SECONDS)) {
            return 409; // MUST: duplicate `confirmed`
        }

        HandleToolmarkConfirmation::dispatch(
            (string) $conversation->getKey(),
            $binding['call_id'],
            $binding['tool_use_id'] ?? null,
            $confirmId,
            $result,
        );

        return 204;
    }

    // ---- helpers --------------------------------------------------------------------------

    private function handOff(string $id, string $json): void
    {
        if ($this->useRedis) {
            $redis = Redis::connection();
            $redis->rpush($this->resultKey($id), $json);
            $redis->expire($this->resultKey($id), 60);
        } else {
            $this->cache->put($this->resultKey($id), $json, 60);
        }
    }

    /** Structural check of a ToolResult (see docs/protocol-v1.md "Tool results"). */
    private function isToolResult(mixed $r): bool
    {
        if (! is_array($r) || ! is_string($r['status'] ?? null)) {
            return false;
        }

        return match ($r['status']) {
            'ok' => true,
            'invalid' => is_array($r['issues'] ?? null),
            'refused' => is_string($r['code'] ?? null) && is_string($r['message'] ?? null),
            'needs_confirmation' => is_string($r['confirmId'] ?? null) && $r['confirmId'] !== ''
                && is_string($r['summary'] ?? null),
            'cancelled' => in_array($r['by'] ?? null, ['operator', 'signal', 'policy'], true),
            'error' => is_string($r['message'] ?? null),
            default => false,
        };
    }

    /** Encodes `{}` as an object: PHP's empty array would be sent as `[]`. */
    private function jsonObject(array|object $input): object
    {
        return is_object($input) ? $input : (object) $input;
    }

    private function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    private function ttlSeconds(int $ms): int
    {
        return (int) ceil($ms / 1000) + 60;
    }

    private function pageKey(Conversation $c): string
    {
        return self::PREFIX."page:{$c->user_id}:{$c->getKey()}";
    }

    private function callKey(string $id): string
    {
        return self::PREFIX."call:{$id}";
    }

    private function claimKey(string $id): string
    {
        return self::PREFIX."claimed:{$id}";
    }

    private function resultKey(string $id): string
    {
        return self::PREFIX."result:{$id}";
    }

    private function confirmKey(string $confirmId): string
    {
        return self::PREFIX."confirm:{$confirmId}";
    }
}
