<?php

namespace Tests\Support;

use App\Models\Conversation;
use App\Models\User;
use App\Toolmark\BrowserBridge;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Cache;

/** Helpers for driving BrowserBridge against a scripted page inside one PHPUnit test. */
trait FakesPage
{
    protected ?FakePageBroadcaster $page = null;

    /**
     * Routes every broadcast to `$onMessage` (the fake page) instead of Reverb.
     *
     * @param \Closure(array<string, mixed>, string): void $onMessage
     */
    protected function onPageMessage(\Closure $onMessage): FakePageBroadcaster
    {
        $this->page = new FakePageBroadcaster($onMessage);
        $page = $this->page;
        Broadcast::extend('fake-page', fn () => $page);
        config([
            'broadcasting.connections.fake-page' => ['driver' => 'fake-page'],
            'broadcasting.default' => 'fake-page',
        ]);
        Broadcast::purge('fake-page');

        return $page;
    }

    /** A bridge with a custom call timeout, also bound for the HTTP endpoint. */
    protected function bridge(int $callTimeoutMs = 5_000): BrowserBridge
    {
        $bridge = new BrowserBridge(
            cache: Cache::store(),
            useRedis: config('database.redis.client') !== null && config('cache.default') === 'redis',
            callTimeoutMs: $callTimeoutMs,
            pollIntervalMs: 5,
        );
        $this->app->instance(BrowserBridge::class, $bridge);

        return $bridge;
    }

    /** @return array{0: User, 1: Conversation} */
    protected function userWithConversation(string $email): array
    {
        $user = User::factory()->create(['email' => $email]);
        $conversation = Conversation::create(['user_id' => $user->getKey(), 'title' => 'Test conversation']);

        return [$user, $conversation];
    }

    protected function bridgeUrl(Conversation $conversation): string
    {
        return '/toolmark/bridge/'.$conversation->getKey();
    }

    /** Sends the page's first manifest over the authenticated endpoint. */
    protected function connectPage(User $user, Conversation $conversation, string $clientId): void
    {
        $this->actingAs($user)->postJson($this->bridgeUrl($conversation), [
            'protocol' => 1,
            'type' => 'manifest',
            'clientId' => $clientId,
            'rev' => 1,
            'tools' => [[
                'name' => 'challenges.create.fill',
                'llmName' => 'challenges_create_fill',
                'description' => 'Fill the create challenge form.',
                'hints' => (object) [],
            ]],
        ])->assertNoContent(204);
    }

    /**
     * @param array<string, mixed> $result
     * @return array<string, mixed>
     */
    protected function resultMessage(string $clientId, string $id, array $result = ['status' => 'ok', 'data' => ['done' => true]]): array
    {
        return ['protocol' => 1, 'type' => 'result', 'clientId' => $clientId, 'id' => $id, 'result' => $result];
    }
}
