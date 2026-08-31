<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A live inbound OnlyFans message (from the `messages.received` webhook) pushed to
 * any open Conversations view. Broadcast synchronously (no queue worker dependency)
 * on a private per-creator channel so chatters only receive their assigned creators.
 *
 * Nothing is persisted — this only mirrors the live thread to connected browsers.
 *
 * @param  array{id:?string,from:string,text:string,time:?string,price:float,isFree:bool,isOpened:bool,isLiked:bool,isTip:bool,mediaCount:int}  $message
 * @param  array{id:string,name:?string,username:?string,avatar:?string}  $fan
 */
class OnlyFansMessageReceived implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $creatorId,
        public string $chatId,
        public array $message,
        public array $fan,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("creator.{$this->creatorId}");
    }

    public function broadcastAs(): string
    {
        return 'message.received';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'creatorId' => $this->creatorId,
            'chatId' => $this->chatId,
            'message' => $this->message,
            'fan' => $this->fan,
        ];
    }
}
