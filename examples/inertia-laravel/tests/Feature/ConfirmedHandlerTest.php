<?php

namespace Tests\Feature;

use App\Models\AgentTurn;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\FakesPage;
use Tests\TestCase;

/** Spec §12.3: a `confirmed` appends the outcome and runs exactly one follow-up turn, no page tools. */
final class ConfirmedHandlerTest extends TestCase
{
    use FakesPage, RefreshDatabase;

    public function test_confirmed_triggers_single_followup_without_tools(): void
    {
        /** @var User $alice */
        /** @var Conversation $conversation */
        [$alice, $conversation] = $this->userWithConversation('alice@example.test');
        [$bob] = $this->userWithConversation('bob@example.test');
        $bridge = $this->bridge();
        $this->connectPage($alice, $conversation, 'page-alice');

        $confirmId = '0b8f8c52-3a4e-4c55-9d7c-0a6c1b2f3e4d';
        $this->onPageMessage(function (array $m) use ($alice, $conversation, $confirmId): void {
            $this->actingAs($alice)->postJson($this->bridgeUrl($conversation), $this->resultMessage('page-alice', $m['id'], [
                'status' => 'needs_confirmation',
                'confirmId' => $confirmId,
                'summary' => 'Archive challenge 1',
            ]))->assertNoContent(204);
        });

        $pending = $bridge->call($conversation, 'challenges.archive', ['challenge' => 1], toolUseId: 'toolu_archive');
        $this->assertSame('needs_confirmation', $pending['status']);
        $this->assertSame(0, $conversation->messages()->count());

        $confirmed = [
            'protocol' => 1, 'type' => 'confirmed', 'clientId' => 'page-alice',
            'confirmId' => $confirmId, 'result' => ['status' => 'ok', 'data' => (object) []],
        ];
        // Only the bound user, conversation and page may confirm.
        $this->actingAs($bob)->postJson($this->bridgeUrl($conversation), $confirmed)->assertForbidden();
        $this->actingAs($alice)->postJson($this->bridgeUrl($conversation), [...$confirmed, 'clientId' => 'page-other'])->assertForbidden();
        $this->assertSame(0, $conversation->messages()->count());

        $this->actingAs($alice)->postJson($this->bridgeUrl($conversation), $confirmed)->assertNoContent(204);
        // A replayed `confirmed` is a duplicate and starts nothing.
        $this->actingAs($alice)->postJson($this->bridgeUrl($conversation), $confirmed)->assertStatus(409);

        $turns = $conversation->messages()->orderBy('id')->get();
        $this->assertCount(2, $turns);

        /** @var AgentTurn $note */
        $note = $turns[0];
        $this->assertSame('system', $note->role);
        $this->assertStringContainsString('page_call toolu_archive', $note->content);
        $this->assertStringContainsString('"status":"ok"', $note->content);
        $this->assertSame(['tool_use_id' => 'toolu_archive', 'protocol_call_id' => $note->meta['protocol_call_id'], 'confirm_id' => $confirmId], $note->meta);

        /** @var AgentTurn $followUp */
        $followUp = $turns[1];
        $this->assertSame('assistant', $followUp->role);
        $this->assertIsArray($followUp->tools);
        $this->assertNotContains('page_call', $followUp->tools);
        $this->assertNotContains('page_describe', $followUp->tools);
        $this->assertSame(1, $followUp->meta['max_steps']);
    }
}
