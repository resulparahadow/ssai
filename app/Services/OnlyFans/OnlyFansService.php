<?php

namespace App\Services\OnlyFans;

use App\Models\AichModel;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Server-side OnlyFans API client (onlyfansapi.com). Holds the API key in config
 * and never exposes it to the browser. Base: https://app.onlyfansapi.com/api ·
 * auth: Bearer <key> · account ids are `acct_XXXX`.
 *
 * Conversations are a LIVE proxy — nothing is persisted. Endpoint methods return
 * the raw Illuminate HTTP Response so the controller can forward status + body
 * (OnlyFans upstream errors pass straight through to the UI). Pure normalisers
 * map OF payloads into the design shape. Send is text-only in v1 (PPV blocked).
 */
class OnlyFansService
{
    public function __construct(
        protected ?string $apiKey = null,
        protected ?string $baseUrl = null,
    ) {
        $this->apiKey ??= (string) config('services.onlyfans.key');
        $this->baseUrl = rtrim($this->baseUrl ?? (string) config('services.onlyfans.base_url') ?: 'https://app.onlyfansapi.com/api', '/');
    }

    public function enabled(): bool
    {
        return $this->apiKey !== '';
    }

    // ---- Chats ------------------------------------------------------------

    public function listChats(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/chats", $this->pageParams($params));
    }

    public function listChatMedia(string $account, string $chatId, array $params = []): Response
    {
        return $this->client()->get("{$account}/chats/{$chatId}/media", $this->pageParams($params));
    }

    // ---- Chat messages ----------------------------------------------------

    public function listMessages(string $account, string $chatId, array $params = []): Response
    {
        return $this->client()->get("{$account}/chats/{$chatId}/messages", $this->pageParams($params));
    }

    public function getMessage(string $account, string $chatId, string $messageId): Response
    {
        return $this->client()->get("{$account}/chats/{$chatId}/messages/{$messageId}");
    }

    public function searchMessages(string $account, string $chatId, array $params = []): Response
    {
        return $this->client()->get("{$account}/chats/{$chatId}/messages/search", $this->pageParams($params));
    }

    /** Send a TEXT message. PPV/paid is blocked in v1; callers must not pass a price. */
    public function sendText(string $account, string $chatId, string $text): Response
    {
        $text = trim($text);
        if ($text === '') {
            throw new RuntimeException('OnlyFans send requires non-empty text.');
        }

        return $this->client()->post("{$account}/chats/{$chatId}/messages", ['text' => $text]);
    }

    public function deleteMessage(string $account, string $chatId, string $messageId): Response
    {
        return $this->client()->delete("{$account}/chats/{$chatId}/messages/{$messageId}");
    }

    public function likeMessage(string $account, string $chatId, string $messageId): Response
    {
        return $this->client()->post("{$account}/chats/{$chatId}/messages/{$messageId}/like");
    }

    public function unlikeMessage(string $account, string $chatId, string $messageId): Response
    {
        return $this->client()->post("{$account}/chats/{$chatId}/messages/{$messageId}/unlike");
    }

    // ---- Users ------------------------------------------------------------

    public function getUser(string $account, string $userId): Response
    {
        return $this->client()->get("{$account}/users/{$userId}");
    }

    // ---- Pure normalisers (mirror legacy js/onlyfans.js) ------------------

    /** Map an OnlyFans chat row to a conversation card. */
    public function normalizeChat(array $chat): array
    {
        $fan = $chat['fan'] ?? $chat['withUser'] ?? [];
        $id = (string) ($fan['id'] ?? '');
        $name = $fan['name'] ?? $fan['username'] ?? $id;

        return [
            'id' => $id,
            'name' => $name,
            'username' => $fan['username'] ?? null,
            'avatar' => $fan['avatar'] ?? null,
            'initials' => $this->initials($name),
            'preview' => $this->htmlToText((string) (data_get($chat, 'lastMessage.text') ?? '')),
            'time' => data_get($chat, 'lastMessage.createdAt'),
            'unread' => (int) ($chat['unreadMessagesCount'] ?? 0),
            'canSend' => (bool) ($chat['canSendMessage'] ?? true),
        ];
    }

    /** Map an OnlyFans message to a thread bubble. `chatId` is the fan's user id. */
    public function normalizeMessage(array $raw, string $chatId): array
    {
        $fromId = (string) (data_get($raw, 'fromUser.id') ?? '');

        return [
            'id' => isset($raw['id']) ? (string) $raw['id'] : null,
            'from' => $fromId === (string) $chatId ? 'fan' : 'creator',
            'text' => $this->htmlToText((string) ($raw['text'] ?? '')),
            'time' => $raw['createdAt'] ?? null,
            'price' => (float) ($raw['price'] ?? 0),
            'isFree' => (bool) ($raw['isFree'] ?? true),
            'isOpened' => (bool) ($raw['isOpened'] ?? false),
            'isLiked' => (bool) ($raw['isLiked'] ?? false),
            'isTip' => (bool) ($raw['isTip'] ?? false),
            'mediaCount' => (int) ($raw['mediaCount'] ?? 0),
        ];
    }

    /** Engine-facing shape ('customer'|'model') for a transient generate session. */
    public function engineMessage(array $raw, string $chatId): array
    {
        $b = $this->normalizeMessage($raw, $chatId);

        return ['sender' => $b['from'] === 'fan' ? 'customer' : 'model', 'text' => $b['text'], 'ts_iso' => $b['time'] ?? now()->toIso8601String()];
    }

    /** Parse allowlisted next-page params from an OnlyFans _pagination block. */
    public function nextCursor(?array $pagination): ?array
    {
        $next = $pagination['next_page'] ?? null;
        if (! $next) {
            return null;
        }

        $out = [];
        if (is_string($next) && str_contains($next, '?')) {
            parse_str(parse_url($next, PHP_URL_QUERY) ?: '', $q);
            foreach (['limit', 'offset', 'id', 'order'] as $k) {
                if (isset($q[$k]) && $q[$k] !== '') {
                    $out[$k] = $q[$k];
                }
            }
        }

        return $out ?: null;
    }

    public function resolveCreator(string $account): ?string
    {
        return AichModel::query()->where('of_account_id', $account)->value('name');
    }

    public function htmlToText(?string $html): string
    {
        if ($html === null || $html === '') {
            return '';
        }

        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        return trim((string) preg_replace('/\s+/', ' ', $text));
    }

    public function ppvBlocked(float|int|string|null $price): bool
    {
        return (float) $price > 0;
    }

    // ---- internals --------------------------------------------------------

    protected function client(): PendingRequest
    {
        if (! $this->enabled()) {
            throw new RuntimeException('ONLYFANS_API_KEY is not configured.');
        }

        return Http::baseUrl($this->baseUrl)
            ->withToken($this->apiKey)
            ->acceptJson()
            ->timeout((int) config('services.onlyfans.timeout', 30))
            ->retry(3, 1000, function ($e) {
                return $e instanceof ConnectionException
                    || ($e instanceof RequestException && $e->response->status() === 429);
            }, throw: false);
    }

    private function initials(string $name): string
    {
        $parts = preg_split('/\s+/', trim($name)) ?: [];

        return strtoupper(implode('', array_map(fn ($w) => mb_substr($w, 0, 1), array_slice($parts, 0, 2)))) ?: '?';
    }

    /** @return array<string, scalar> */
    private function pageParams(array $params): array
    {
        return collect($params)
            ->only(['limit', 'offset', 'order', 'skip_users', 'filter', 'query', 'first_id', 'last_id', 'id'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all();
    }
}
