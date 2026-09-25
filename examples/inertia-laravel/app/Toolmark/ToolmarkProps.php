<?php
// file: app/Toolmark/ToolmarkProps.php
namespace App\Toolmark;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;

/** Builds the `toolmark` Inertia prop: the server-declared tools the current user may run. */
final class ToolmarkProps
{
    // Client limits (@toolmark/inertia MAX_PROPS_TOOL_* and friends). Keep them in sync.
    private const MAX_ENTRIES = 64;
    private const MAX_TITLE = 128; // UTF-16 code units, as the client counts
    private const MAX_DESCRIPTION = 2048; // UTF-16 code units
    private const MAX_SCHEMA_BYTES = 32768; // UTF-8 bytes of the JSON: never less than the client's count
    private const NAME = '/^[A-Za-z0-9_.-]{1,128}\z/'; // \z: `$` would accept a trailing newline
    private const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
    private const RESERVED_KEYS = ['_method', '_token'];
    private const HINTS = ['readOnly', 'consequential', 'destructive', 'untrustedContent'];

    /**
     * @param list<ServerTool> $tools Every tool this page could offer; tools the user may not run
     *   are left out.
     * @return list<array<string, mixed>>
     */
    public static function for(Request $request, array $tools): array
    {
        // MUST (§12.4): authorize as the user who receives this page (a guest is null: policies
        // without a nullable User parameter deny).
        $gate = Gate::forUser($request->user());
        // The page's own scheme and host, so every URL is absolute and same-origin. Behind a proxy
        // this needs TrustProxies, like the rest of the app.
        $origin = $request->getSchemeAndHttpHost();

        $entries = [];
        foreach ($tools as $tool) {
            $problem = self::problem($tool);
            if ($problem !== null) {
                self::misconfigured($tool->name, $problem);
                continue;
            }
            // MUST: only tools this user is authorized to run. Anything but an explicit allow
            // (a deny, or no gate or policy method for the ability) leaves the tool out.
            if (! $gate->allows($tool->ability, $tool->arguments)) {
                continue;
            }
            if (count($entries) === self::MAX_ENTRIES) {
                self::misconfigured($tool->name, 'more than '.self::MAX_ENTRIES.' tools on one page');
                break;
            }
            $entries[] = self::entry($tool, $origin);
        }

        return $entries;
    }

    /** @return array<string, mixed> */
    private static function entry(ServerTool $tool, string $origin): array
    {
        $entry = [
            'name' => $tool->name,
            'description' => $tool->description,
            'inputSchema' => $tool->inputSchema,
            'visit' => [
                // Absolute, same-origin: this request's scheme + host + the route's path.
                'url' => $origin.route($tool->route, $tool->routeParameters, absolute: false),
                'method' => $tool->method,
            ],
        ];
        if ($tool->title !== null) {
            $entry['title'] = $tool->title;
        }
        $hints = $tool->hints;
        if ($tool->method !== 'get') {
            // A mutation always needs a confirmation (the client enforces this too).
            unset($hints['readOnly']);
            $hints['consequential'] = true;
        }
        if ($hints !== []) {
            $entry['hints'] = $hints;
        }

        return $entry;
    }

    /** Why the tool cannot be rendered, or null. Mirrors the client's `invalid_props_tool` checks. */
    private static function problem(ServerTool $tool): ?string
    {
        if (preg_match(self::NAME, $tool->name) !== 1) {
            return 'the name is not a valid tool name';
        }
        if (trim($tool->description) === '' || self::utf16Length($tool->description) > self::MAX_DESCRIPTION) {
            return 'the description must be 1 to '.self::MAX_DESCRIPTION.' characters';
        }
        if ($tool->title !== null && self::utf16Length($tool->title) > self::MAX_TITLE) {
            return 'the title is longer than '.self::MAX_TITLE.' characters';
        }
        if (! in_array($tool->method, self::METHODS, true)) {
            return 'the method must be one of '.implode(', ', self::METHODS);
        }
        foreach ($tool->hints as $key => $value) {
            if (! in_array($key, self::HINTS, true) || ! is_bool($value)) {
                return "hint \"{$key}\" is not a known boolean hint";
            }
        }
        $route = Route::getRoutes()->getByName($tool->route);
        if ($route === null) {
            return "no route is named \"{$tool->route}\"";
        }
        if (! in_array(strtoupper($tool->method), $route->methods(), true)) {
            return "route \"{$tool->route}\" does not accept ".strtoupper($tool->method);
        }
        $schema = $tool->inputSchema;
        // A non-GET tool's input becomes the request body: the root must be a closed object.
        if ($tool->method !== 'get'
            && (($schema['type'] ?? null) !== 'object' || ($schema['additionalProperties'] ?? null) !== false)) {
            return 'a non-GET tool needs a closed root schema (type object, additionalProperties false)';
        }
        $schemaProblem = self::schemaProblem($schema);
        if ($schemaProblem !== null) {
            return $schemaProblem;
        }
        try {
            $json = json_encode($schema, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        } catch (\JsonException) {
            return 'the input schema is not JSON-encodable';
        }
        if (strlen($json) > self::MAX_SCHEMA_BYTES) {
            return 'the input schema is larger than '.self::MAX_SCHEMA_BYTES.' bytes of JSON';
        }

        return null;
    }

    /**
     * Walks the whole schema like the client does: reserved keys in any `properties`, and PHP's
     * empty-array pitfall (an empty `properties`/`$defs` array encodes as `[]`, which the client
     * rejects; write `(object) []`).
     */
    private static function schemaProblem(mixed $node): ?string
    {
        if ($node instanceof \stdClass) {
            $node = get_object_vars($node);
        }
        if (! is_array($node)) {
            return null;
        }
        foreach (['properties', '$defs'] as $key) {
            if (! array_key_exists($key, $node)) {
                continue;
            }
            $map = $node[$key] instanceof \stdClass ? get_object_vars($node[$key]) : $node[$key];
            if (is_array($map) && array_is_list($map) && ! ($node[$key] instanceof \stdClass)) {
                return "\"{$key}\" must be a JSON object (write (object) [] when it is empty)";
            }
            if ($key === 'properties' && is_array($map)) {
                foreach (self::RESERVED_KEYS as $reserved) {
                    if (array_key_exists($reserved, $map)) {
                        return "the input schema declares the reserved key \"{$reserved}\"";
                    }
                }
            }
        }
        foreach ($node as $child) {
            $problem = self::schemaProblem($child);
            if ($problem !== null) {
                return $problem;
            }
        }

        return null;
    }

    private static function utf16Length(string $s): int
    {
        return intdiv(strlen(mb_convert_encoding($s, 'UTF-16LE', 'UTF-8')), 2);
    }

    /** Development: fail loudly. Production: report and skip, as the client does with an event. */
    private static function misconfigured(string $name, string $problem): void
    {
        $message = "Toolmark props tool \"{$name}\" skipped: {$problem}";
        if (app()->isProduction()) {
            Log::warning($message);

            return;
        }
        throw new \LogicException($message);
    }
}
