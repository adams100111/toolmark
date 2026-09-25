<?php
// file: app/Toolmark/HandleToolmarkConfirmation.php
namespace App\Toolmark;

use App\Models\Conversation;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

final class HandleToolmarkConfirmation implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /**
     * @param string $callId the protocol call id (audit only; the model never saw it)
     * @param string|null $toolUseId the provider's id of the original `page_call` tool use
     * @param array<string, mixed> $result the final ToolResult from the page
     */
    public function __construct(
        public readonly string $conversationId,
        public readonly string $callId,
        public readonly ?string $toolUseId,
        public readonly string $confirmId,
        public readonly array $result,
    ) {}

    public function handle(AgentRunner $agent): void
    {
        $conversation = Conversation::findOrFail($this->conversationId);

        // 1. Append the outcome as a tool result (see above): a synthetic `page_confirmation` tool
        //    use naming the original page_call, then its result. Never a system message: the
        //    result comes from the page, so it is marked as untrusted data (spec §14).
        $syntheticId = 'page_confirmation_'.$this->confirmId;
        $conversation->messages()->create([
            'role' => 'assistant',
            'content' => 'Checking the outcome of the pending page action.',
            'meta' => [ // your provider's tool-use block
                'tool_use' => [
                    'id' => $syntheticId,
                    'name' => 'page_confirmation',
                    'input' => ['tool_use_id' => $this->toolUseId, 'confirm_id' => $this->confirmId],
                ],
            ],
        ]);
        $conversation->messages()->create([
            'role' => 'tool',
            'content' => json_encode(PageCallTool::markUntrusted($this->result), JSON_THROW_ON_ERROR),
            'meta' => [ // `tool_use_id` pairs it with the tool use above; the rest is bookkeeping
                'tool_use_id' => $syntheticId,
                'page_call_tool_use_id' => $this->toolUseId,
                'protocol_call_id' => $this->callId,
                'confirm_id' => $this->confirmId,
            ],
        ]);

        // 2. Exactly one follow-up turn: acknowledge only, no tools at all.
        $agent->runTurn(
            conversation: $conversation,
            tools: [], // page_call / page_describe withheld (or definitions + tool_choice none, above)
            instructions: 'The user answered a pending confirmation; its outcome is the last tool result. '
                .'Briefly tell the user what happened. Do not start new actions.',
            maxSteps: 1,
        );
    }
}
