<?php

namespace App\Services\OnlyFans;

use App\Models\AichModel;
use Carbon\Carbon;
use Exception;
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

    public function muteChat(string $account, string $chatId): Response
    {
        return $this->client()->post("{$account}/chats/{$chatId}/mute");
    }

    /** NB: unmute is DELETE on its OWN path (`/unmute`), not DELETE on `/mute`. */
    public function unmuteChat(string $account, string $chatId): Response
    {
        return $this->client()->delete("{$account}/chats/{$chatId}/unmute");
    }

    /** Hide a chat from the list. Only undone by sending the fan a new message. */
    public function hideChat(string $account, string $chatId): Response
    {
        return $this->client()->post("{$account}/chats/{$chatId}/hide");
    }

    public function markChatRead(string $account, string $chatId): Response
    {
        return $this->client()->post("{$account}/chats/{$chatId}/mark-as-read");
    }

    public function markChatUnread(string $account, string $chatId): Response
    {
        return $this->client()->post("{$account}/chats/{$chatId}/mark-as-unread");
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

    /** Send a Giphy GIF (by its giphy id) to a chat, with optional accompanying text. */
    public function sendGif(string $account, string $chatId, string $giphyId, string $text = ''): Response
    {
        $body = ['giphyId' => $giphyId];
        $text = trim($text);
        if ($text !== '') {
            $body['text'] = $text;
        }

        return $this->client()->post("{$account}/chats/{$chatId}/messages", $body);
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

    public function pinMessage(string $account, string $chatId, string $messageId): Response
    {
        return $this->client()->post("{$account}/chats/{$chatId}/messages/{$messageId}/pin");
    }

    /** NB: unpin is DELETE on its OWN path (`/unpin`), not DELETE on `/pin`. */
    public function unpinMessage(string $account, string $chatId, string $messageId): Response
    {
        return $this->client()->delete("{$account}/chats/{$chatId}/messages/{$messageId}/unpin");
    }

    // ---- Giphy ------------------------------------------------------------
    // Giphy proxy: a returned GIF's `id` is used as the `giphyId` body param on send.

    public function listGiphyTrending(string $account): Response
    {
        return $this->client()->get("{$account}/giphy/trending");
    }

    /** Search GIFs. `q` is required; `limit` (max 50) and `offset` are optional. */
    public function searchGiphy(string $account, array $params): Response
    {
        return $this->client()->get("{$account}/giphy/search", collect($params)
            ->only(['q', 'limit', 'offset'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all());
    }

    // ---- Users ------------------------------------------------------------

    public function getUser(string $account, string $userId): Response
    {
        return $this->client()->get("{$account}/users/{$userId}");
    }

    /** Mass-fetch up to 10 users in one call (`data` is keyed by user id). */
    public function listUserDetails(string $account, array $ids): Response
    {
        return $this->client()->get("{$account}/users/list", ['ids' => implode(',', array_slice(array_values($ids), 0, 10))]);
    }

    // ---- Account status ---------------------------------------------------

    /** The connected creator's own profile + `isAuth` connection flag. */
    public function getMe(string $account): Response
    {
        return $this->client()->get("{$account}/me");
    }

    // ---- Fans -------------------------------------------------------------

    /** List fans in a bucket: active | all | expired. */
    public function listFans(string $account, string $bucket, array $params = []): Response
    {
        $bucket = in_array($bucket, ['active', 'all', 'expired'], true) ? $bucket : 'active';

        return $this->client()->get("{$account}/fans/{$bucket}", $this->fanParams($params));
    }

    /** Top spenders (sortable by total|tips|messages|subscribes|post|streams). */
    public function listTopFans(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/fans/top", $this->fanParams($params));
    }

    public function getFanSubscriptionHistory(string $account, string $userId): Response
    {
        return $this->client()->get("{$account}/fans/{$userId}/subscriptions-history");
    }

    /**
     * The fan's OnlyFans-native note (visible to the creator inside the OnlyFans app).
     * Distinct from the AI-facing memory on `customer_profiles`, which mirrors this value.
     */
    public function getFanNotes(string $account, string $fanId): Response
    {
        return $this->client()->get("{$account}/fans/{$fanId}/notes");
    }

    public function setFanNotes(string $account, string $fanId, string $notes): Response
    {
        return $this->client()->put("{$account}/fans/{$fanId}/notes", ['notes' => $notes]);
    }

    public function clearFanNotes(string $account, string $fanId): Response
    {
        return $this->client()->delete("{$account}/fans/{$fanId}/notes");
    }

    /** Set the fan's custom name shown in OnlyFans. `null`/'' clears it. */
    public function setFanCustomName(string $account, string $fanId, ?string $name): Response
    {
        return $this->client()->put("{$account}/fans/{$fanId}/custom-name", ['custom_name' => $name]);
    }

    /**
     * Pull a fan's lifetime spend + subscription status out of a GET users/{id}
     * payload, read defensively across the shapes OnlyFans returns (the fan→creator
     * relationship lives under subscribedByData or subscribedOnData depending on
     * endpoint/version). Any field we can't find comes back null so callers keep
     * their last-known value rather than clobbering it with 0.
     *
     * @param  array<string, mixed>  $d  the `data` object from getUser
     * @return array{total: float|null, tips: float|null, status: string|null}
     */
    public function extractFanSpend(array $d): array
    {
        $by = is_array($d['subscribedByData'] ?? null) ? $d['subscribedByData'] : [];
        $on = is_array($d['subscribedOnData'] ?? null) ? $d['subscribedOnData'] : [];

        $total = $by['totalSumm'] ?? $on['totalSumm'] ?? $d['totalSpent'] ?? null;
        $tips = $by['tipsSumm'] ?? $on['tipsSumm'] ?? $d['tips'] ?? null;

        $subscribed = $d['isSubscribed'] ?? $by['subscribed'] ?? $on['subscribed'] ?? null;
        $status = $subscribed === null ? null : ($subscribed ? 'subscribed' : 'expired');

        return [
            'total' => $total === null ? null : (float) $total,
            'tips' => $tips === null ? null : (float) $tips,
            'status' => $status,
        ];
    }

    /**
     * Pull a fan's subscription state *to this creator* out of a GET users/{id}
     * payload, for the chat fan panel's indicators.
     *
     * OnlyFans splits the two directions and only one is meaningful here:
     * `subscribedBy*` is the creator's subscription TO the fan (near-always empty),
     * `subscribedOn*` is the fan's subscription to the creator. Same contract as
     * extractFanSpend(): anything the payload can't answer comes back null, so an
     * unknown never renders as a confident `false` a chatter would act on.
     *
     * @param  array<string, mixed>  $d  the `data` object from getUser
     * @return array{subscribed: bool|null, durationLabel: string|null, subscribedAt: string|null, expiredAt: string|null}
     */
    public function extractFanSubscription(array $d): array
    {
        $on = is_array($d['subscribedOnData'] ?? null) ? $d['subscribedOnData'] : [];

        return [
            'subscribed' => $this->fanSubscribed($d, $on),
            'durationLabel' => $this->fanDurationLabel($d, $on),
            'subscribedAt' => $on['subscribeAt'] ?? null,
            'expiredAt' => $on['expiredAt'] ?? null,
        ];
    }

    /**
     * @param  array<string, mixed>  $d
     * @param  array<string, mixed>  $on
     */
    private function fanSubscribed(array $d, array $on): ?bool
    {
        // Leads because Mass-List sends `subscribedOn: null` next to a meaningful
        // `subscribedOnExpiredNow: true`.
        if (is_bool($d['subscribedOnExpiredNow'] ?? null)) {
            return ! $d['subscribedOnExpiredNow'];
        }

        if (is_bool($d['subscribedOn'] ?? null)) {
            return $d['subscribedOn'];
        }

        $expiredAt = $on['expiredAt'] ?? null;

        if (is_string($expiredAt) && trim($expiredAt) !== '') {
            try {
                return Carbon::parse($expiredAt)->isFuture();
            } catch (Exception) {
                return null; // unparseable date → unknown, not "expired"
            }
        }

        return null;
    }

    /**
     * OnlyFans' own human-readable label ("1 month"), preferred so the panel agrees
     * with what the creator sees in the OF UI. Empty strings are absent, not values.
     *
     * @param  array<string, mixed>  $d
     * @param  array<string, mixed>  $on
     */
    private function fanDurationLabel(array $d, array $on): ?string
    {
        foreach ([$d['subscribedOnDuration'] ?? null, $on['duration'] ?? null] as $label) {
            if (is_string($label) && trim($label) !== '') {
                return $label;
            }
        }

        return null;
    }

    // ---- Settings ---------------------------------------------------------

    public function getSettings(string $account): Response
    {
        return $this->client()->get("{$account}/settings");
    }

    /** Update profile text fields. Only pass keys you want to change; `null` clears a field. */
    public function updateProfile(string $account, array $data): Response
    {
        return $this->client()->post("{$account}/settings/profile", $data);
    }

    /** Price accepts "0" | "free" | "4.99".."200". OnlyFans caps this to 3 updates/day. */
    public function updateSubscriptionPrice(string $account, string $price): Response
    {
        return $this->client()->patch("{$account}/settings/subscription-price", ['price' => $price]);
    }

    // ---- Welcome message --------------------------------------------------

    public function getWelcomeMessage(string $account): Response
    {
        return $this->client()->get("{$account}/settings/welcome-message");
    }

    /** Set the welcome-message body (text-only in v1; media/price deferred). */
    public function updateWelcomeMessage(string $account, array $data): Response
    {
        return $this->client()->post("{$account}/settings/welcome-message", $data);
    }

    public function setWelcomeMessageEnabled(string $account, bool $enabled): Response
    {
        return $this->client()->patch("{$account}/settings/welcome-message", ['enabled' => $enabled]);
    }

    // ---- Notifications ----------------------------------------------------

    public function listNotifications(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/notifications", $this->notifParams($params));
    }

    public function getNotificationCounts(string $account): Response
    {
        return $this->client()->get("{$account}/notifications/counts");
    }

    public function markAllNotificationsRead(string $account): Response
    {
        return $this->client()->post("{$account}/notifications/mark-all-as-read");
    }

    // ---- Users · moderation (getUser above) -------------------------------

    /**
     * Users this account has blocked. Params: limit (1-50), offset, query (name/username).
     * Response: `data.list[]` + `data.hasMore` + `data.nextOffset`.
     */
    public function listBlockedUsers(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/users/blocked", $this->pageParams($params));
    }

    /**
     * Users this account has restricted. Same shape/params as `listBlockedUsers`.
     *
     * NB: the list path is `/users/restricted`. The docs example's `_pagination.next_page`
     * shows `/users/restrict` — that path 500s (verified live); don't "correct" this to it.
     */
    public function listRestrictedUsers(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/users/restricted", $this->pageParams($params));
    }

    public function blockUser(string $account, string $userId): Response
    {
        return $this->client()->post("{$account}/users/{$userId}/block");
    }

    public function unblockUser(string $account, string $userId): Response
    {
        return $this->client()->delete("{$account}/users/{$userId}/block");
    }

    public function restrictUser(string $account, string $userId): Response
    {
        return $this->client()->post("{$account}/users/{$userId}/restrict");
    }

    public function unrestrictUser(string $account, string $userId): Response
    {
        return $this->client()->delete("{$account}/users/{$userId}/restrict");
    }

    public function subscribeToUser(string $account, string $userId): Response
    {
        return $this->client()->post("{$account}/users/{$userId}/subscribe");
    }

    public function unsubscribeFromUser(string $account, string $userId): Response
    {
        return $this->client()->delete("{$account}/users/{$userId}/subscribe");
    }

    // ---- Tracking links ---------------------------------------------------

    public function listTrackingLinks(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/tracking-links", $this->linkParams($params));
    }

    public function createTrackingLink(string $account, array $data): Response
    {
        return $this->client()->post("{$account}/tracking-links", $data);
    }

    public function deleteTrackingLink(string $account, string $linkId): Response
    {
        return $this->client()->delete("{$account}/tracking-links/{$linkId}");
    }

    public function getTrackingLinkStats(string $account, string $linkId, array $params = []): Response
    {
        return $this->client()->get("{$account}/tracking-links/{$linkId}/stats", $this->linkParams($params));
    }

    // ---- Free-trial links -------------------------------------------------

    public function listTrialLinks(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/trial-links", $this->linkParams($params));
    }

    public function createTrialLink(string $account, array $data): Response
    {
        return $this->client()->post("{$account}/trial-links", $data);
    }

    public function deleteTrialLink(string $account, string $linkId): Response
    {
        return $this->client()->delete("{$account}/trial-links/{$linkId}");
    }

    public function getTrialLinkStats(string $account, string $linkId, array $params = []): Response
    {
        return $this->client()->get("{$account}/trial-links/{$linkId}/stats", $this->linkParams($params));
    }

    // ---- Smart links ------------------------------------------------------
    // Smart links are an agency-level resource (`/smart-links`, no account path
    // segment); list/create are scoped to one creator via the `account_ids`/
    // `account_id` param, while per-link ops address the smart_link_id directly.

    public function listSmartLinks(string $account, array $params = []): Response
    {
        return $this->client()->get('smart-links', array_merge(['account_ids' => $account], $this->smartLinkParams($params)));
    }

    public function createSmartLink(string $account, array $data): Response
    {
        return $this->client()->post('smart-links', array_merge(['account_id' => $account], $data));
    }

    public function deleteSmartLink(string $linkId): Response
    {
        return $this->client()->delete("smart-links/{$linkId}");
    }

    public function getSmartLinkStats(string $linkId, array $params = []): Response
    {
        return $this->client()->get("smart-links/{$linkId}/stats", $this->smartLinkParams($params));
    }

    public function listSmartLinkFans(string $linkId, array $params = []): Response
    {
        return $this->client()->get("smart-links/{$linkId}/fans", $this->smartLinkParams($params));
    }

    public function listSmartLinkSpenders(string $linkId, array $params = []): Response
    {
        return $this->client()->get("smart-links/{$linkId}/spenders", $this->smartLinkParams($params));
    }

    public function listSmartLinkClicks(string $linkId, array $params = []): Response
    {
        return $this->client()->get("smart-links/{$linkId}/clicks", $this->smartLinkParams($params));
    }

    public function listSmartLinkConversions(string $linkId, array $params = []): Response
    {
        return $this->client()->get("smart-links/{$linkId}/conversions", $this->smartLinkParams($params));
    }

    public function listSmartLinkTags(string $linkId): Response
    {
        return $this->client()->get("smart-links/{$linkId}/tags");
    }

    public function addSmartLinkTags(string $linkId, array $tags): Response
    {
        return $this->client()->post("smart-links/{$linkId}/tags", ['tags' => array_values($tags)]);
    }

    public function removeSmartLinkTags(string $linkId, array $tags): Response
    {
        return $this->client()->delete("smart-links/{$linkId}/tags", ['tags' => array_values($tags)]);
    }

    // ---- Link tags --------------------------------------------------------

    /** Agency-wide tags used across trial/tracking/smart links (optional `type` filter). */
    public function listLinkTags(array $params = []): Response
    {
        return $this->client()->get('link-tags', collect($params)->only(['type'])->filter(fn ($v) => $v !== null && $v !== '')->all());
    }

    // ---- Promotions -------------------------------------------------------
    // Subscription promo campaigns offered to new/expired fans.

    public function listPromotions(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/promotions", $this->pageParams($params));
    }

    public function createPromotion(string $account, array $data): Response
    {
        return $this->client()->post("{$account}/promotions", $data);
    }

    public function stopPromotion(string $account, string $promotionId): Response
    {
        return $this->client()->post("{$account}/promotions/{$promotionId}/stop");
    }

    public function deletePromotion(string $account, string $promotionId): Response
    {
        return $this->client()->delete("{$account}/promotions/{$promotionId}");
    }

    // ---- Subscription bundles ---------------------------------------------
    // Discounted multi-month subscription offers.

    public function listBundles(string $account): Response
    {
        return $this->client()->get("{$account}/bundles");
    }

    public function createBundle(string $account, array $data): Response
    {
        return $this->client()->post("{$account}/bundles", $data);
    }

    public function deleteBundle(string $account, string $bundleId): Response
    {
        return $this->client()->delete("{$account}/bundles/{$bundleId}");
    }

    // ---- Media ------------------------------------------------------------

    /**
     * Fetch the bytes for an OnlyFans CDN URL. `cdn*.onlyfans.com` URLs are
     * IP-locked to the proxy that fetched them, so the browser (and our server)
     * get a 403 hitting them directly — this download endpoint streams the file
     * back through the proxy. The API 302-redirects to a fansapi.com URL serving
     * the bytes; Guzzle follows the redirect. (Billed per download — cache results.)
     */
    public function downloadMedia(string $account, string $cdnUrl): Response
    {
        if (! $this->enabled()) {
            throw new RuntimeException('ONLYFANS_API_KEY is not configured.');
        }

        // The CDN url is a single, pre-encoded path segment (it contains ?, &, =, /).
        $url = $this->baseUrl.'/'.$account.'/media/download/'.rawurlencode($cdnUrl);

        return Http::withToken($this->apiKey)
            ->timeout((int) config('services.onlyfans.timeout', 30))
            ->get($url);
    }

    /** SSRF guard: only proxy https URLs on an onlyfans.com host. */
    public function isOnlyFansCdnUrl(string $url): bool
    {
        if (! str_starts_with($url, 'https://')) {
            return false;
        }

        $host = (string) (parse_url($url, PHP_URL_HOST) ?: '');

        return $host !== '' && (bool) preg_match('/(^|\.)onlyfans\.com$/i', $host);
    }

    // ---- Pure normalisers (mirror legacy js/onlyfans.js) ------------------

    /**
     * The label to show for a fan. A custom name (set via `setFanCustomName`) rides on
     * `displayName` and is empty otherwise, so it wins when present — matching what
     * OnlyFans itself shows in the chat list — and `name` is the fallback.
     */
    public function displayNameOf(array $user): string
    {
        $custom = trim((string) ($user['displayName'] ?? ''));

        return $custom !== ''
            ? $custom
            : (string) ($user['name'] ?? $user['username'] ?? ($user['id'] ?? ''));
    }

    /** Map an OnlyFans chat row to a conversation card. */
    public function normalizeChat(array $chat): array
    {
        $fan = $chat['fan'] ?? $chat['withUser'] ?? [];
        $id = (string) ($fan['id'] ?? '');
        $name = $this->displayNameOf($fan);
        $lastMessage = is_array($chat['lastMessage'] ?? null) ? $chat['lastMessage'] : [];

        return [
            'id' => $id,
            'name' => $name,
            'username' => $fan['username'] ?? null,
            'avatar' => $fan['avatar'] ?? null,
            'initials' => $this->initials($name),
            'preview' => $this->htmlToPreview((string) ($lastMessage['text'] ?? '')),
            'previewKind' => $this->lastMessageKind($lastMessage),
            'time' => $lastMessage['createdAt'] ?? null,
            'unread' => (int) ($chat['unreadMessagesCount'] ?? 0),
            'canSend' => (bool) ($chat['canSendMessage'] ?? true),
            // Mute + pin state ride along on the chat list, so the header renders them
            // without a per-chat call.
            'muted' => (bool) ($chat['isMutedNotifications'] ?? false),
            'pinnedCount' => (int) ($chat['countPinnedMessages'] ?? 0),
            // So does the fan's restricted state — the list can flag it without a getUser.
            'restricted' => (bool) ($fan['isRestricted'] ?? false),
            // Lifetime spend is embedded in the listed fan object, so the list can flag
            // spenders without a per-fan getUser call. null when the payload omits it.
            'totalSpent' => $this->extractFanSpend($fan)['total'],
        ];
    }

    /**
     * Classify a chat's last message for the conversation-list preview when it carries no
     * text (a GIF, photo, video, voice note, tip, or locked PPV) — the list shows an icon +
     * label instead of a bare "—". Returns null when text is present (the text is shown).
     *
     * @param  array<string, mixed>  $lastMessage
     */
    public function lastMessageKind(array $lastMessage): ?string
    {
        if ($lastMessage === [] || $this->htmlToPreview((string) ($lastMessage['text'] ?? '')) !== '') {
            return null;
        }

        $giphyId = $lastMessage['giphyId'] ?? null;
        if ($giphyId !== null && $giphyId !== '') {
            return 'gif';
        }

        $media = is_array($lastMessage['media'] ?? null) ? $lastMessage['media'] : [];
        if ($media !== []) {
            $types = array_map(fn ($m) => (string) (is_array($m) ? ($m['type'] ?? '') : ''), $media);

            if (in_array('gif', $types, true)) {
                return 'gif';
            }
            // Every media item is pay-to-view → render it as a locked PPV bundle.
            if (! collect($media)->contains(fn ($m) => is_array($m) && ! empty($m['canView']))) {
                return 'locked';
            }
            if (in_array('video', $types, true)) {
                return 'video';
            }
            if (in_array('audio', $types, true)) {
                return 'audio';
            }
            if (in_array('photo', $types, true)) {
                return 'photo';
            }

            return 'media';
        }

        if ((int) ($lastMessage['mediaCount'] ?? 0) > 0) {
            return 'media';
        }

        return ! empty($lastMessage['isTip']) ? 'tip' : null;
    }

    /** Map an OnlyFans message to a thread bubble. `chatId` is the fan's user id. */
    public function normalizeMessage(array $raw, string $chatId): array
    {
        $fromId = (string) (data_get($raw, 'fromUser.id') ?? '');
        $media = $this->normalizeMedia($raw);

        // A sent GIF comes back as a `giphyId` with empty text + empty media, so rebuild a
        // renderable media item from the public Giphy CDN (loaded directly, not via the OF proxy).
        $giphyId = $raw['giphyId'] ?? null;
        if ($giphyId !== null && $giphyId !== '' && $media === []) {
            $media = [$this->giphyMedia((string) $giphyId)];
        }

        return [
            'id' => isset($raw['id']) ? (string) $raw['id'] : null,
            'from' => $fromId === (string) $chatId ? 'fan' : 'creator',
            'text' => $this->htmlToText((string) ($raw['text'] ?? '')),
            'time' => $raw['createdAt'] ?? null,
            'price' => (float) ($raw['price'] ?? 0),
            'isFree' => (bool) ($raw['isFree'] ?? true),
            'isOpened' => (bool) ($raw['isOpened'] ?? false),
            'isLiked' => (bool) ($raw['isLiked'] ?? false),
            'isPinned' => (bool) ($raw['isPinned'] ?? false),
            'isTip' => (bool) ($raw['isTip'] ?? false),
            'mediaCount' => $media !== [] ? count($media) : (int) ($raw['mediaCount'] ?? 0),
            'media' => $media,
        ];
    }

    /**
     * Build a renderable media item for a Giphy GIF id. The OnlyFans message only stores the
     * `giphyId`, so we point at Giphy's public CDN (id-addressable, no signing/IP-lock). `direct`
     * tells the frontend to load it as-is rather than through the OF media proxy.
     *
     * @return array<string, mixed>
     */
    public function giphyMedia(string $giphyId): array
    {
        return [
            'id' => $giphyId,
            'type' => 'gif',
            'canView' => true,
            'thumb' => "https://media.giphy.com/media/{$giphyId}/200w.gif",
            'preview' => "https://media.giphy.com/media/{$giphyId}/200w.gif",
            'full' => "https://media.giphy.com/media/{$giphyId}/giphy.gif",
            'source' => null,
            'duration' => null,
            'width' => null,
            'height' => null,
            'direct' => true,
        ];
    }

    /**
     * Pull a compact, frontend-ready media list out of a raw OnlyFans message. Keeps just the
     * signed thumbnail/preview/full CloudFront URLs + display metadata; `preview`/`thumb` is the
     * poster for a video, `source` is its playable MP4 (from `videoSources`), and locked/PPV or
     * DRM media has no `source` (only a poster) with `canView=false` for locked items.
     *
     * @return list<array<string, mixed>>
     */
    public function normalizeMedia(array $raw): array
    {
        $items = $raw['media'] ?? [];
        if (! is_array($items)) {
            return [];
        }

        return collect($items)->map(function (array $m): array {
            $files = $m['files'] ?? [];

            return [
                'id' => isset($m['id']) ? (string) $m['id'] : null,
                'type' => (string) ($m['type'] ?? 'photo'),
                'canView' => (bool) ($m['canView'] ?? false),
                'thumb' => data_get($files, 'thumb.url'),
                'preview' => data_get($files, 'preview.url') ?? data_get($files, 'squarePreview.url'),
                'full' => data_get($files, 'full.url'),
                'source' => $this->bestVideoSource($m),
                'duration' => isset($m['duration']) ? (int) $m['duration'] : null,
                'width' => data_get($files, 'full.width') ?? data_get($files, 'preview.width'),
                'height' => data_get($files, 'full.height') ?? data_get($files, 'preview.height'),
            ];
        })->values()->all();
    }

    /**
     * Pick the playable MP4 URL for a video media item. OnlyFans returns direct video links in
     * `videoSources`, keyed by vertical resolution ("240", "720", …); we take the highest-res
     * non-null one. Non-DRM videos carry these; DRM-protected videos expose only a `files.drm`
     * HLS/DASH manifest (unplayable in a plain <video>) and return null here — the frontend then
     * shows just the poster. The url is still IP-locked CDN, so it loads through the media proxy.
     *
     * @param  array<string, mixed>  $m
     */
    private function bestVideoSource(array $m): ?string
    {
        if (($m['type'] ?? null) !== 'video') {
            return null;
        }

        // Prefer the highest-resolution direct MP4 from `videoSources`.
        $sources = $m['videoSources'] ?? null;
        if (is_array($sources)) {
            $best = null;
            $bestRes = -1;

            foreach ($sources as $res => $url) {
                if (! is_string($url) || $url === '') {
                    continue;
                }

                $r = (int) $res;
                if ($r >= $bestRes) {
                    $bestRes = $r;
                    $best = $url;
                }
            }

            if ($best !== null) {
                return $best;
            }
        }

        // Fallback: a non-DRM video may expose the MP4 directly as `files.full.url`.
        // (DRM-protected videos leave this null — only a `files.drm` manifest exists.)
        $full = data_get($m, 'files.full.url');

        return is_string($full) && $full !== '' ? $full : null;
    }

    /**
     * Map a Giphy result (trending uses `images.fixed_width`, search uses
     * `images.fixed_height`; both carry `images.original`). The preview/full URLs
     * are Giphy CDN (media.giphy.com) — browser-loadable, NOT IP-locked like OF CDN.
     *
     * @return array<string, mixed>
     */
    public function normalizeGif(array $g): array
    {
        $img = $g['images'] ?? [];
        $fixed = $img['fixed_width'] ?? $img['fixed_height'] ?? [];
        $orig = $img['original'] ?? [];
        $preview = data_get($fixed, 'url') ?? data_get($orig, 'url');

        return [
            'id' => isset($g['id']) ? (string) $g['id'] : null,
            'title' => $g['title'] ?? null,
            'preview' => $preview,
            'url' => data_get($orig, 'url') ?? $preview,
            'width' => (int) (data_get($fixed, 'width') ?? data_get($orig, 'width') ?? 0),
            'height' => (int) (data_get($fixed, 'height') ?? data_get($orig, 'height') ?? 0),
        ];
    }

    /**
     * Map a fan row to a card. Handles both `fans/active|all|expired` (`data.list[]`)
     * and `fans/top` (`data.users[]`) — both carry a `subscribedOnData` block.
     */
    public function normalizeFan(array $f): array
    {
        $sub = $f['subscribedOnData'] ?? [];
        $name = $f['name'] ?? $f['username'] ?? (string) ($f['id'] ?? '');

        return [
            'id' => isset($f['id']) ? (string) $f['id'] : null,
            'name' => $name,
            'username' => $f['username'] ?? null,
            'avatar' => data_get($f, 'avatarThumbs.c144') ?? ($f['avatar'] ?? null),
            'initials' => $this->initials($name),
            'isVerified' => (bool) ($f['isVerified'] ?? false),
            'online' => (bool) ($f['isOnline'] ?? false),
            'durationLabel' => $f['subscribedOnDuration'] ?? null,
            'totalSpent' => (float) ($sub['totalSumm'] ?? 0),
            'tips' => (float) ($sub['tipsSumm'] ?? 0),
            'ppv' => (float) ($sub['messagesSumm'] ?? 0),
            'subs' => (float) ($sub['subscribesSumm'] ?? 0),
            'subscribePrice' => isset($sub['regularPrice']) ? (float) $sub['regularPrice'] : (isset($sub['price']) ? (float) $sub['price'] : null),
            'subscribedAt' => $sub['subscribeAt'] ?? null,
            'expiresAt' => $sub['expiredAt'] ?? null,
            'lastSeen' => $f['lastSeen'] ?? null,
            'blocked' => (bool) ($f['isBlocked'] ?? false),
        ];
    }

    /** Compact connection-status shape from GET {account}/me. */
    public function normalizeAccountStatus(array $me): array
    {
        return [
            'isAuth' => (bool) ($me['isAuth'] ?? false),
            'id' => isset($me['id']) ? (string) $me['id'] : null,
            'username' => $me['username'] ?? null,
            'name' => $me['name'] ?? null,
            'avatar' => $me['avatar'] ?? null,
            'subscribersCount' => isset($me['subscribersCount']) ? (int) $me['subscribersCount'] : null,
            'postsCount' => isset($me['postsCount']) ? (int) $me['postsCount'] : null,
        ];
    }

    /** Compact welcome-message shape (text kept as raw HTML; reuses normalizeMedia). */
    public function normalizeWelcomeMessage(array $w): array
    {
        return [
            'id' => isset($w['id']) ? (string) $w['id'] : null,
            'text' => (string) ($w['text'] ?? ''),
            'isActive' => (bool) ($w['isActive'] ?? false),
            'price' => isset($w['price']) ? (float) $w['price'] : 0.0,
            'lockedText' => (bool) ($w['lockedText'] ?? false),
            'mediaCount' => (int) ($w['mediaCount'] ?? 0),
            'media' => $this->normalizeMedia($w),
        ];
    }

    /**
     * Map a notification to a compact row. The raw `text` carries placeholders
     * ({SUBSCRIBER_LINK}, {PRICE}, …) whose values in `replacePairs` are HTML —
     * substitute them in, then strip to plain text (no HTML reaches the client).
     */
    public function normalizeNotification(array $n): array
    {
        $text = (string) ($n['text'] ?? '');
        $pairs = $n['replacePairs'] ?? [];
        if (is_array($pairs)) {
            foreach ($pairs as $k => $v) {
                $text = str_replace((string) $k, $this->htmlToText((string) $v), $text);
            }
        }

        return [
            'id' => isset($n['id']) ? (string) $n['id'] : null,
            'type' => (string) ($n['type'] ?? ''),
            'subType' => $n['subType'] ?? null,
            'createdAt' => $n['createdAt'] ?? null,
            'isRead' => (bool) ($n['isRead'] ?? false),
            'text' => $this->htmlToText($text),
            'canGoToProfile' => (bool) ($n['canGoToProfile'] ?? false),
            'userId' => isset($n['user']['id']) ? (string) $n['user']['id'] : null,
        ];
    }

    /**
     * Rich user-detail shape for the model show page's Users tab (lookup + moderation) and
     * the blocked/restricted lists, which return the same user object.
     *
     * NB: OnlyFans exposes NO "blocked at"/"restricted at" timestamp anywhere — `lastSeen` is
     * the only date on a moderated user, so the lists can't be ordered or filtered by when the
     * action happened.
     */
    public function normalizeUserDetail(array $u): array
    {
        $name = $u['name'] ?? $u['username'] ?? (string) ($u['id'] ?? '');

        return [
            'id' => isset($u['id']) ? (string) $u['id'] : null,
            'name' => $name,
            'username' => $u['username'] ?? null,
            'displayName' => $u['displayName'] ?? null,
            'avatar' => $u['avatar'] ?? null,
            'initials' => $this->initials($name),
            'about' => $this->htmlToText($u['about'] ?? ''),
            'location' => $u['location'] ?? null,
            'subscribePrice' => isset($u['subscribePrice']) ? (float) $u['subscribePrice'] : null,
            'isVerified' => (bool) ($u['isVerified'] ?? false),
            'isBlocked' => (bool) ($u['isBlocked'] ?? false),
            'isRestricted' => (bool) ($u['isRestricted'] ?? false),
            // Restricting is one-way per user: OnlyFans sets canRestrict=false once restricted.
            'canRestrict' => (bool) ($u['canRestrict'] ?? false),
            'isActive' => (bool) ($u['isActive'] ?? false),
            'lastSeen' => $u['lastSeen'] ?? null,
            'subscribedBy' => (bool) ($u['subscribedBy'] ?? false),
            'subscribedByExpire' => $u['subscribedByExpire'] ?? $u['subscribedByExpireDate'] ?? null,
            // `subscribedOn*` = their subscription to THIS creator (the useful direction on a
            // moderated user: were they a paying fan, and are they still?).
            'subscribedOn' => (bool) ($u['subscribedOn'] ?? false),
            'subscribedOnExpired' => (bool) ($u['subscribedOnExpiredNow'] ?? false),
            'subscribedOnDuration' => $u['subscribedOnDuration'] ?? null,
            'canChat' => (bool) ($u['canChat'] ?? false),
            'postsCount' => (int) ($u['postsCount'] ?? 0),
            'photosCount' => (int) ($u['photosCount'] ?? 0),
            'videosCount' => (int) ($u['videosCount'] ?? 0),
            'favoritedCount' => (int) ($u['favoritedCount'] ?? 0),
        ];
    }

    /** Map a tracking-link row. */
    public function normalizeTrackingLink(array $l): array
    {
        $rev = $l['revenue'] ?? [];

        return [
            'id' => isset($l['id']) ? (string) $l['id'] : null,
            'name' => $l['campaignName'] ?? null,
            'url' => $l['campaignUrl'] ?? null,
            'clicks' => (int) ($l['clicksCount'] ?? 0),
            'subscribers' => (int) ($l['subscribersCount'] ?? 0),
            'createdAt' => $l['createdAt'] ?? null,
            'endDate' => $l['endDate'] ?? null,
            'tags' => array_values($l['tags'] ?? []),
            'revenue' => (float) ($rev['total'] ?? 0),
            'revenuePerSubscriber' => (float) ($rev['revenuePerSubscriber'] ?? 0),
            'revenuePerClick' => (float) ($rev['revenuePerClick'] ?? 0),
            'spenders' => (int) ($rev['spendersCount'] ?? 0),
        ];
    }

    /** Map a free-trial-link row. */
    public function normalizeTrialLink(array $l): array
    {
        $rev = $l['revenue'] ?? [];

        return [
            'id' => isset($l['id']) ? (string) $l['id'] : null,
            'name' => $l['trialLinkName'] ?? null,
            'url' => $l['url'] ?? null,
            'subscribeDays' => (int) ($l['subscribeDays'] ?? 0),
            'subscribeCounts' => (int) ($l['subscribeCounts'] ?? 0),
            'claimCounts' => (int) ($l['claimCounts'] ?? 0),
            'clicksCounts' => (int) ($l['clicksCounts'] ?? 0),
            'createdAt' => $l['createdAt'] ?? null,
            'expiredAt' => $l['expiredAt'] ?? null,
            'isFinished' => (bool) ($l['isFinished'] ?? false),
            'tags' => array_values($l['tags'] ?? []),
            'revenue' => (float) ($rev['total'] ?? 0),
            'revenuePerSubscriber' => (float) ($rev['revenuePerSubscriber'] ?? 0),
            'spenders' => (int) ($rev['spendersCount'] ?? 0),
        ];
    }

    /** Compact summary from a tracking/trial-link stats response (`data.summary`). */
    public function normalizeLinkStats(array $data): array
    {
        $s = $data['summary'] ?? [];

        return [
            'clicks' => (int) ($s['clicks_total'] ?? 0),
            'subs' => (int) ($s['subs_total'] ?? 0),
            'revenue' => (float) ($s['revenue_total'] ?? 0),
            'spenders' => (int) ($s['spenders_total'] ?? 0),
        ];
    }

    /** Map a promotion row (list `data.items[]` / create `data[]` share this shape). */
    public function normalizePromotion(array $p): array
    {
        return [
            'id' => isset($p['id']) ? (string) $p['id'] : null,
            'message' => $p['message'] ?? null,
            'type' => $p['type'] ?? null,
            'price' => (float) ($p['price'] ?? 0),
            'subscribeCounts' => (int) ($p['subscribeCounts'] ?? 0),
            'subscribeDays' => (int) ($p['subscribeDays'] ?? 0),
            'claimsCount' => (int) ($p['claimsCount'] ?? 0),
            'canClaim' => (bool) ($p['canClaim'] ?? false),
            'createdAt' => $p['createdAt'] ?? null,
            'finishedAt' => $p['finishedAt'] ?? null,
            'isFinished' => (bool) ($p['isFinished'] ?? false),
        ];
    }

    /** Map a subscription-bundle row (list/create/delete share this shape). */
    public function normalizeBundle(array $b): array
    {
        return [
            'id' => isset($b['id']) ? (string) $b['id'] : null,
            'discount' => (int) ($b['discount'] ?? 0),
            'duration' => (int) ($b['duration'] ?? 0),
            'price' => (float) ($b['price'] ?? 0),
            'canBuy' => (bool) ($b['canBuy'] ?? false),
        ];
    }

    /** Map a Smart Link row (list/create/get share this shape). */
    public function normalizeSmartLink(array $l): array
    {
        $acct = $l['account'] ?? [];

        return [
            'id' => isset($l['id']) ? (string) $l['id'] : null,
            'name' => $l['name'] ?? null,
            'linkType' => $l['link_type'] ?? null,
            'url' => $l['traffic_redirect_url'] ?? null,
            'freeTrialDays' => isset($l['free_trial_days']) ? (int) $l['free_trial_days'] : null,
            'clicks' => (int) ($l['clicks_count'] ?? 0),
            'conversions' => (int) ($l['conversions_count'] ?? 0),
            'subscribers' => (int) ($l['subscribers_count'] ?? 0),
            'spenders' => (int) ($l['spenders_count'] ?? 0),
            'revenue' => (float) ($l['revenue'] ?? 0),
            'account' => [
                'id' => isset($acct['id']) ? (string) $acct['id'] : null,
                'displayName' => $acct['display_name'] ?? null,
                'username' => $acct['username'] ?? null,
            ],
            'createdAt' => $l['created_at'] ?? null,
        ];
    }

    /** Map a Smart Link fan row (`data.rows[]`). */
    public function normalizeSmartLinkFan(array $f): array
    {
        return [
            'fanId' => isset($f['fan_id']) ? (string) $f['fan_id'] : null,
            'onlyfansId' => isset($f['onlyfans_id']) ? (string) $f['onlyfans_id'] : null,
            'username' => $f['username'] ?? null,
            'name' => $f['name'] ?? null,
            'avatar' => $f['avatar_url'] ?? null,
            'revenueNet' => (float) ($f['revenue_net'] ?? 0),
            'tipsNet' => (float) ($f['tips_net'] ?? 0),
            'messagesSentByFan' => (int) ($f['messages_sent_by_fan'] ?? 0),
            'convertedAt' => $f['converted_at'] ?? null,
        ];
    }

    /** Map a Smart Link spender row (`data[]`). */
    public function normalizeSmartLinkSpender(array $s): array
    {
        $rev = $s['revenue'] ?? [];

        return [
            'onlyfansId' => isset($s['onlyfans_id']) ? (string) $s['onlyfans_id'] : null,
            'username' => $s['username'] ?? null,
            'revenue' => (float) ($rev['total'] ?? 0),
        ];
    }

    /** Map a Smart Link click row (`data.rows[]`) — compact, analytics-light. */
    public function normalizeSmartLinkClick(array $c): array
    {
        return [
            'id' => isset($c['id']) ? (string) $c['id'] : null,
            'createdAt' => $c['created_at'] ?? null,
            'referrer' => $c['referrer'] ?? null,
            'countryCode' => $c['country_code'] ?? null,
            'browserName' => $c['browser_name'] ?? null,
            'deviceType' => $c['browser_device_type'] ?? null,
            'isBot' => (bool) ($c['is_bot'] ?? false),
            'isDuplicate' => (bool) ($c['is_duplicate'] ?? false),
            'utmSource' => $c['utm_source'] ?? null,
        ];
    }

    /** Map a Smart Link conversion row (`data.rows[]`). */
    public function normalizeSmartLinkConversion(array $c): array
    {
        $fan = $c['fan'] ?? [];

        return [
            'id' => isset($c['id']) ? (string) $c['id'] : null,
            'conversionType' => $c['conversion_type'] ?? null,
            'amountGross' => (float) ($c['amount_gross'] ?? 0),
            'amountNet' => (float) ($c['amount_net'] ?? 0),
            'conversionAt' => $c['conversion_at'] ?? null,
            'fan' => [
                'onlyfansId' => isset($fan['onlyfans_id']) ? (string) $fan['onlyfans_id'] : null,
                'username' => $fan['username'] ?? null,
                'name' => $fan['name'] ?? null,
                'avatar' => $fan['avatar_url'] ?? null,
            ],
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
            // Chat messages paginate on first_id (order=desc) / last_id (order=asc); other
            // list endpoints use id/offset — carry through whichever the next_page URL sets.
            foreach (['limit', 'offset', 'id', 'order', 'first_id', 'last_id'] as $k) {
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

    /**
     * Flatten OnlyFans message HTML to plain text, PRESERVING line breaks.
     *
     * OnlyFans stores DM text as HTML (`<p>`, `<br />`, `<a>`, `<span>`), so block
     * boundaries must become newlines BEFORE strip_tags removes them — otherwise
     * `<p>a</p><p>b</p>` collapses to "ab". Only horizontal whitespace is collapsed;
     * `/\s+/` would destroy the newlines we just recovered.
     */
    public function htmlToText(?string $html): string
    {
        if ($html === null || $html === '') {
            return '';
        }

        // `\s*` after the tag absorbs OnlyFans' own "<br />\n" (one break, not two).
        $text = preg_replace('#<br\s*/?>\s*#i', "\n", $html);
        $text = preg_replace('#</p>\s*<p[^>]*>#i', "\n\n", (string) $text);
        $text = preg_replace('#</?p[^>]*>#i', '', (string) $text);

        $text = html_entity_decode(strip_tags((string) $text), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $text = preg_replace('/[ \t\x{00A0}]+/u', ' ', $text);  // horizontal only — NOT \s+
        $text = preg_replace('/ *\n */', "\n", (string) $text);
        $text = preg_replace('/\n{3,}/', "\n\n", (string) $text);

        return trim((string) $text);
    }

    /** Single-line flattening for the chat-list preview row, which cannot show breaks. */
    public function htmlToPreview(?string $html): string
    {
        return trim((string) preg_replace('/\s+/', ' ', $this->htmlToText($html)));
    }

    public function ppvBlocked(float|int|string|null $price): bool
    {
        return (float) $price > 0;
    }

    // ---- Analytics — Summary (agency-wide; take account_ids[]) -------------

    public function earningsOverview(array $body): Response
    {
        return $this->client()->post('analytics/summary/earnings', $body);
    }

    public function historicalPerformance(array $body): Response
    {
        return $this->client()->post('analytics/summary/historical', $body);
    }

    public function periodComparison(array $body): Response
    {
        return $this->client()->post('analytics/summary/comparison', $body);
    }

    // ---- Analytics — Financial --------------------------------------------

    public function transactionSummary(array $body): Response
    {
        return $this->client()->post('analytics/financial/transactions/summary', $body);
    }

    public function transactionsByType(array $body): Response
    {
        return $this->client()->post('analytics/financial/transactions/by-type', $body);
    }

    public function revenueForecast(array $body): Response
    {
        return $this->client()->post('analytics/financial/forecast', $body);
    }

    public function profitability(array $body): Response
    {
        return $this->client()->post('analytics/financial/profitability', $body);
    }

    public function profitabilityHistory(string $account, array $params = []): Response
    {
        return $this->client()->get("analytics/financial/profitability/{$account}/history", $this->profitHistoryParams($params));
    }

    // ---- Fans — AI Summary (per-account, per-fan) -------------------------

    public function getFanSummary(string $account, string $fanId): Response
    {
        return $this->client()->get("{$account}/fans/{$fanId}/summary");
    }

    public function generateFanSummary(string $account, string $fanId, bool $regenerate = false): Response
    {
        return $this->client()->post("{$account}/fans/{$fanId}/summary", $regenerate ? ['regenerate' => true] : []);
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

    /** @return array<string, mixed> */
    private function fanParams(array $params): array
    {
        return collect($params)
            ->only(['limit', 'offset', 'type', 'query', 'by', 'start_date', 'end_date', 'filter'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all();
    }

    /** @return array<string, mixed> */
    private function notifParams(array $params): array
    {
        return collect($params)
            ->only(['type', 'limit', 'from_id', 'skip_users'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all();
    }

    /** @return array<string, mixed> */
    private function linkParams(array $params): array
    {
        return collect($params)
            ->only(['startDate', 'endDate', 'with_deleted', 'sortby', 'sort', 'field', 'limit', 'offset', 'date_start', 'date_end'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all();
    }

    /** Whitelist across all Smart Link query params (list/stats/fans/spenders/clicks/conversions). @return array<string, mixed> */
    private function smartLinkParams(array $params): array
    {
        return collect($params)
            ->only([
                'limit', 'offset', 'name', 'sort', 'date_start', 'date_end',
                'has_messages', 'min_messages_sent_by_fan', 'min_revenue_net', 'min_tips_net',
                'minSpend', 'include_bots', 'include_duplicates', 'conversion_type', 'onlyfans_user_id',
            ])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all();
    }

    /** @return array<string, mixed> */
    private function profitHistoryParams(array $params): array
    {
        return collect($params)
            ->only(['account_prefixed_id', 'months'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all();
    }
}
