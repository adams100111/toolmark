<?php
// file: app/Toolmark/AgentTool.php
namespace App\Toolmark;

interface AgentTool
{
    public function name(): string;

    public function description(): string;

    /** @return array<string, mixed> JSON Schema of the tool input */
    public function schema(): array;

    /**
     * @param array<string, mixed> $args
     * @param string $toolUseId the LLM provider's id of this tool use
     * @return array<string, mixed> tool result for the model
     */
    public function handle(array $args, string $toolUseId): array;
}
