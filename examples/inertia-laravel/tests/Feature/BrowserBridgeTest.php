<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\Support\FakesPage;
use Tests\TestCase;

/** Spec §12.2 security MUSTs of the bridge, end to end through the authenticated endpoint. */
final class BrowserBridgeTest extends TestCase
{
    use FakesPage, RefreshDatabase;

    private User $alice;

    private User $bob;

    private Conversation $aliceConversation;

    private Conversation $bobConversation;

    protected function setUp(): void
    {
        parent::setUp();
        [$this->alice, $this->aliceConversation] = $this->userWithConversation('alice@example.test');
        [$this->bob, $this->bobConversation] = $this->userWithConversation('bob@example.test');
    }

    public function test_rejects_result_from_other_user(): void
    {
        $bridge = $this->bridge();
        $this->connectPage($this->alice, $this->aliceConversation, 'page-alice');
        $this->connectPage($this->bob, $this->bobConversation, 'page-bob');

        $statuses = [];
        $this->onPageMessage(function (array $m) use (&$statuses): void {
            if ($m['type'] !== 'call') {
                return;
            }
            // Bob replays Alice's call id on his own (authorized) conversation endpoint.
            $statuses['bob_own_conversation'] = $this->actingAs($this->bob)
                ->postJson($this->bridgeUrl($this->bobConversation), $this->resultMessage('page-bob', $m['id']))
                ->status();
            // Bob posts to Alice's conversation endpoint.
            $statuses['bob_alice_endpoint'] = $this->actingAs($this->bob)
                ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-alice', $m['id']))
                ->status();
            // Alice, but from another page (clientId).
            $statuses['other_client'] = $this->actingAs($this->alice)
                ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-other', $m['id']))
                ->status();
            // The real page.
            $statuses['page'] = $this->actingAs($this->alice)
                ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-alice', $m['id']))
                ->status();
        });

        $result = $bridge->call($this->aliceConversation, 'challenges.create.fill', ['values' => ['type' => 'hackathon']]);

        $this->assertSame(['status' => 'ok', 'data' => ['done' => true]], $result);
        $this->assertSame([
            'bob_own_conversation' => 403,
            'bob_alice_endpoint' => 403,
            'other_client' => 403,
            'page' => 204,
        ], $statuses);
        // The call went out on Alice's private channel only, addressed to her page.
        $this->assertCount(1, $this->page->sent);
        $this->assertSame(
            "private-toolmark.{$this->alice->getKey()}.{$this->aliceConversation->getKey()}",
            $this->page->sent[0]['channel'],
        );
        $this->assertSame('page-alice', $this->page->sent[0]['message']['clientId']);
    }

    public function test_rejects_unknown_or_duplicate_id(): void
    {
        $bridge = $this->bridge();
        $this->connectPage($this->alice, $this->aliceConversation, 'page-alice');

        // Never issued.
        $this->actingAs($this->alice)
            ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-alice', 'c-never-issued'))
            ->assertStatus(404);
        $this->actingAs($this->alice)
            ->postJson($this->bridgeUrl($this->aliceConversation), [
                'protocol' => 1, 'type' => 'confirmed', 'clientId' => 'page-alice',
                'confirmId' => 'f-never-issued', 'result' => ['status' => 'ok'],
            ])
            ->assertStatus(404);

        $statuses = [];
        $this->onPageMessage(function (array $m) use (&$statuses): void {
            $first = $this->resultMessage('page-alice', $m['id'], ['status' => 'ok', 'data' => ['n' => 1]]);
            $second = $this->resultMessage('page-alice', $m['id'], ['status' => 'ok', 'data' => ['n' => 2]]);
            $statuses[] = $this->actingAs($this->alice)->postJson($this->bridgeUrl($this->aliceConversation), $first)->status();
            $statuses[] = $this->actingAs($this->alice)->postJson($this->bridgeUrl($this->aliceConversation), $second)->status();
        });

        $result = $bridge->call($this->aliceConversation, 'challenges.create.fill', []);

        $this->assertSame([204, 409], $statuses);
        $this->assertSame(['status' => 'ok', 'data' => ['n' => 1]], $result);
    }

    public function test_rejects_after_deadline(): void
    {
        $bridge = $this->bridge(callTimeoutMs: 1);
        $this->connectPage($this->alice, $this->aliceConversation, 'page-alice');

        $late = null;
        $callId = null;
        $this->onPageMessage(function (array $m) use (&$late, &$callId): void {
            if ($m['type'] !== 'call') {
                return;
            }
            $callId = $m['id'];
            usleep(20_000); // past the 1 ms deadline
            $late = $this->actingAs($this->alice)
                ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-alice', $m['id']))
                ->status();
        });

        $result = $bridge->call($this->aliceConversation, 'challenges.create.fill', []);

        $this->assertSame(['status' => 'timeout'], $result);
        $this->assertSame(410, $late);
        // After the timeout the page is told to stop, and anything it still sends is rejected.
        $cancel = $this->page->sent[1]['message'] ?? null;
        $this->assertSame(['protocol' => 1, 'type' => 'cancel', 'clientId' => 'page-alice', 'id' => $callId], $cancel);
        $this->actingAs($this->alice)
            ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-alice', $callId))
            ->assertStatus(410);
    }

    public function test_accepts_valid_result_once(): void
    {
        $bridge = $this->bridge();
        $this->connectPage($this->alice, $this->aliceConversation, 'page-alice');

        $sent = [];
        $this->onPageMessage(function (array $m) use (&$sent): void {
            $sent[] = $m;
            $result = $m['type'] === 'describe'
                ? ['status' => 'ok', 'data' => ['name' => $m['tool'], 'inputSchema' => ['type' => 'object']]]
                : ['status' => 'ok', 'data' => ['changes' => []]];
            $this->actingAs($this->alice)
                ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-alice', $m['id'], $result))
                ->assertNoContent(204);
        });

        $described = $bridge->describe($this->aliceConversation, 'challenges.create.fill');
        $called = $bridge->call($this->aliceConversation, 'challenges.create.fill', [], rev: 1, toolUseId: 'toolu_1');

        $this->assertSame('challenges.create.fill', $described['data']['name']);
        $this->assertSame(['status' => 'ok', 'data' => ['changes' => []]], $called);
        // Unguessable, distinct ids; the call carries the rev the model saw and an object input.
        $this->assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $sent[0]['id']);
        $this->assertNotSame($sent[0]['id'], $sent[1]['id']);
        $this->assertSame(1, $sent[1]['rev']);
        $this->assertSame('{}', json_encode($sent[1]['input']));
        // A second result for an answered id is a duplicate.
        $this->actingAs($this->alice)
            ->postJson($this->bridgeUrl($this->aliceConversation), $this->resultMessage('page-alice', $sent[1]['id']))
            ->assertStatus(409);
    }

    public function test_channel_auth_only_owner(): void
    {
        $channel = fn (User $u, Conversation $c): string => "private-toolmark.{$u->getKey()}.{$c->getKey()}";
        $auth = fn (string $name) => ['channel_name' => $name, 'socket_id' => '1234.5678'];

        $this->actingAs($this->alice)
            ->post('/broadcasting/auth', $auth($channel($this->alice, $this->aliceConversation)))
            ->assertOk();
        // Another user, or the owner with someone else's conversation, is refused.
        $this->actingAs($this->bob)
            ->post('/broadcasting/auth', $auth($channel($this->alice, $this->aliceConversation)))
            ->assertForbidden();
        $this->actingAs($this->alice)
            ->post('/broadcasting/auth', $auth($channel($this->alice, $this->bobConversation)))
            ->assertForbidden();
        $this->actingAs($this->bob)
            ->post('/broadcasting/auth', $auth($channel($this->bob, $this->aliceConversation)))
            ->assertForbidden();
    }

    public function test_bridge_endpoint_requires_the_conversation_owner(): void
    {
        $manifest = ['protocol' => 1, 'type' => 'manifest', 'clientId' => 'x', 'rev' => 1, 'tools' => []];

        $this->postJson($this->bridgeUrl($this->aliceConversation), $manifest)->assertUnauthorized();
        $this->actingAs($this->bob)->postJson($this->bridgeUrl($this->aliceConversation), $manifest)->assertForbidden();
        $this->actingAs($this->alice)->postJson($this->bridgeUrl($this->aliceConversation), $manifest)->assertNoContent(204);
        $this->actingAs($this->alice)
            ->postJson($this->bridgeUrl($this->aliceConversation), ['protocol' => 2, 'type' => 'manifest', 'clientId' => 'x', 'rev' => 1, 'tools' => []])
            ->assertStatus(422);
        // The endpoint sits in the `web` group: session auth plus CSRF (skipped by the framework in
        // unit tests, so asserted structurally here).
        $route = app('router')->getRoutes()->match(Request::create($this->bridgeUrl($this->aliceConversation), 'POST'));
        $this->assertContains('web', $route->gatherMiddleware());
    }
}
