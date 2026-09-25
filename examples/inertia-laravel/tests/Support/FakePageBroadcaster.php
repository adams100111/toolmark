<?php

namespace Tests\Support;

use Illuminate\Broadcasting\Broadcasters\Broadcaster;
use Illuminate\Http\Request;

/**
 * Stands in for the page at the other end of the private channel: every broadcast protocol
 * message is handed to a callback, synchronously, while BrowserBridge is still sending.
 */
final class FakePageBroadcaster extends Broadcaster
{
    /** @var list<array{channel: string, message: array<string, mixed>}> */
    public array $sent = [];

    /** @param \Closure(array<string, mixed>, string): void $onMessage */
    public function __construct(private \Closure $onMessage) {}

    public function auth($request)
    {
        return true;
    }

    public function validAuthenticationResponse($request, $result)
    {
        return $result;
    }

    public function broadcast(array $channels, $event, array $payload = [])
    {
        foreach ($channels as $channel) {
            $name = (string) $channel;
            $message = $payload['message'];
            $this->sent[] = ['channel' => $name, 'message' => $message];
            ($this->onMessage)($message, $name);
        }
    }
}
