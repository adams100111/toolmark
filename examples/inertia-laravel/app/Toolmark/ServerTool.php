<?php
// file: app/Toolmark/ServerTool.php
namespace App\Toolmark;

/**
 * One server-declared tool: what the agent sees, the route the visit hits, and the Gate ability
 * the current user must pass for the tool to be rendered at all.
 */
final readonly class ServerTool
{
    /**
     * @param string $name ^[A-Za-z0-9_.-]{1,128}$; registered on the page exactly as given.
     * @param string $description For the model. Constant text written in code, never user content.
     * @param string $route Name of the route the visit hits (e.g. 'posts.update').
     * @param array<string, mixed> $routeParameters Route parameters (models are fine).
     * @param 'get'|'post'|'put'|'patch'|'delete' $method A method that route accepts.
     * @param array<string, mixed> $inputSchema JSON Schema in the fromJsonSchema subset.
     * @param string $ability Gate ability or policy method (e.g. 'update'). There is no default:
     *   every tool names the authorization it needs.
     * @param mixed $arguments Gate arguments: a model, a class name, or an array of them.
     * @param array{readOnly?: bool, consequential?: bool, destructive?: bool, untrustedContent?: bool} $hints
     */
    public function __construct(
        public string $name,
        public string $description,
        public string $route,
        public array $routeParameters,
        public string $method,
        public array $inputSchema,
        public string $ability,
        public mixed $arguments = [],
        public ?string $title = null,
        public array $hints = [],
    ) {}
}
