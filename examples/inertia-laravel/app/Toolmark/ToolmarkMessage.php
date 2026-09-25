<?php
// file: app/Toolmark/ToolmarkMessage.php
namespace App\Toolmark;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

/** One agent→page protocol message, broadcast on the conversation's private channel. */
final class ToolmarkMessage implements ShouldBroadcastNow
{
    /** @param array<string, mixed> $message */
    public function __construct(
        public readonly int $userId,
        public readonly string $conversationId,
        public readonly array $message,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("toolmark.{$this->userId}.{$this->conversationId}");
    }

    public function broadcastAs(): string
    {
        return 'toolmark.message'; // the page listens to '.toolmark.message' (the default)
    }

    /** @return array{message: array<string, mixed>} */
    public function broadcastWith(): array
    {
        return ['message' => $this->message];
    }
}
