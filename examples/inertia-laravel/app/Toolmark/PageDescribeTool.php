<?php
// file: app/Toolmark/PageDescribeTool.php
namespace App\Toolmark;

use App\Models\Conversation;

final class PageDescribeTool implements AgentTool
{
    public function __construct(
        private readonly BrowserBridge $bridge,
        private readonly Conversation $conversation,
    ) {}

    public function name(): string
    {
        return 'page_describe';
    }

    public function description(): string
    {
        return 'Get the full definition of one page tool, including its JSON input schema. Use it before calling a tool whose input you do not know.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'tool' => ['type' => 'string', 'description' => 'Exact tool name from the page manifest'],
            ],
            'required' => ['tool'],
            'additionalProperties' => false,
        ];
    }

    public function handle(array $args, string $toolUseId): array
    {
        return $this->bridge->describe($this->conversation, (string) $args['tool']);
    }
}
