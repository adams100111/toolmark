<?php
// file: app/Toolmark/AgentRunner.php
namespace App\Toolmark;

use App\Models\Conversation;

/**
 * Your agent loop, as HandleToolmarkConfirmation uses it: runs one turn of the conversation with
 * the given tools. Implement it over your agent library (the example binds a scripted runner).
 */
interface AgentRunner
{
    /**
     * @param list<AgentTool> $tools the tools the model may call in this turn ([] = none)
     * @param string $instructions extra instructions for this turn only
     * @param int $maxSteps model steps allowed in this turn
     */
    public function runTurn(Conversation $conversation, array $tools, string $instructions, int $maxSteps): void;
}
