<?php
// file: app/Toolmark/BridgeController.php
namespace App\Toolmark;

use App\Models\Conversation;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class BridgeController
{
    /** Same bound as the page's default inbound limit (maxMessageBytes). */
    private const MAX_BYTES = 1_048_576;

    public function __invoke(Request $request, Conversation $conversation, BrowserBridge $bridge): Response
    {
        // MUST: the authenticated user owns the conversation (the `can:view` policy above, again
        // here so the check survives route changes).
        abort_unless((string) $conversation->user_id === (string) $request->user()->getKey(), 403);

        $raw = $request->getContent();
        if (strlen($raw) > self::MAX_BYTES) {
            return response()->noContent(413);
        }
        try {
            $message = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); // depth 64, like the page
        } catch (\JsonException) {
            return response()->noContent(422);
        }
        if (! is_array($message)) {
            return response()->noContent(422);
        }

        return response()->noContent($bridge->accept($conversation, $message));
    }
}
