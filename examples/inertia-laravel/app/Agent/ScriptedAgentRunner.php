<?php

namespace App\Agent;

use App\Models\Conversation;
use App\Toolmark\AgentRunner;
use App\Toolmark\AgentTool;

/**
 * The example's stand-in for an LLM agent loop (no model is called): a turn records one assistant
 * message acknowledging the last message, plus the tools the turn was allowed to call.
 */
final class ScriptedAgentRunner implements AgentRunner
{
    public function runTurn(Conversation $conversation, array $tools, string $instructions, int $maxSteps): void
    {
        $conversation->messages()->create([
            'role' => 'assistant',
            'content' => 'Done: the pending page action was resolved in the page.',
            'tools' => array_values(array_map(fn (AgentTool $tool): string => $tool->name(), $tools)),
            'meta' => ['instructions' => $instructions, 'max_steps' => $maxSteps],
        ]);
    }
}
