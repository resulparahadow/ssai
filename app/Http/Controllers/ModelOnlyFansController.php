<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ForwardsOnlyFansErrors;
use App\Models\AichModel;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\Client\Response;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Validator;

/**
 * Live OnlyFans account-management proxy for the Creator Model show page —
 * nothing is persisted. Manager/admin only (routes are gated by `manage-team`,
 * so unlike OnlyFansChatController there's no per-creator assignment scope here).
 * Each endpoint resolves the creator's `of_account_id`, calls OnlyFans, and
 * returns the normalised result or forwards the upstream error status/body.
 */
class ModelOnlyFansController extends Controller
{
    use ForwardsOnlyFansErrors;

    public function __construct(protected OnlyFansService $of) {}

    /**
     * Every OnlyFans account connected to the agency's OnlyFansAPI key.
     *
     * The ONE method here that takes no `AichModel`: the vendor's `accounts` endpoint is
     * agency-level, and the Creator Models picker needs the list precisely when a model
     * has no `of_account_id` yet. Routed at `of/accounts` rather than under `models/…`,
     * where the `models/{model}` wildcard registered above would swallow it.
     */
    public function accounts(Request $request): JsonResponse
    {
        if (! $this->of->enabled()) {
            abort(503, 'OnlyFans API key is not configured.');
        }

        $res = $this->of->listAccounts($request->only(['onlyfans_id', 'onlyfans_username', 'onlyfans_email']));

        if (! $res->successful()) {
            return $this->forward($res);
        }

        // This endpoint answers with a BARE ARRAY (no `data`, no `_meta`) — unwrap
        // defensively anyway, so a vendor change to the house wrapper isn't an outage.
        $body = $res->json();
        $rows = array_is_list($body ?? []) ? $body : ($body['data'] ?? []);

        return response()->json([
            'accounts' => array_values(array_map(
                fn (array $a) => $this->of->normalizeAccount($a),
                array_filter(is_array($rows) ? $rows : [], 'is_array'),
            )),
        ]);
    }

    /** Live connection status + the real OnlyFans profile (avatar, @username, subscribers). */
    public function status(AichModel $model): JsonResponse
    {
        $res = $this->of->getMe($this->account($model));

        return $res->successful()
            ? response()->json(['status' => $this->of->normalizeAccountStatus($res->json('data') ?? [])])
            : $this->forward($res);
    }

    /** AI profile summary for a fan (poll after generate). */
    public function fanSummary(AichModel $model, string $fan): JsonResponse
    {
        $res = $this->of->getFanSummary($this->account($model), $fan);

        return $res->successful() ? response()->json($res->json()) : $this->forward($res);
    }

    /** Queue (re)generation of a fan's AI profile summary — 200 credits, async. */
    public function generateFanSummary(Request $request, AichModel $model, string $fan): JsonResponse
    {
        $res = $this->of->generateFanSummary($this->account($model), $fan, $request->boolean('regenerate'));

        return $res->successful() ? response()->json($res->json()) : $this->forward($res);
    }

    public function fans(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $params = $request->only(['bucket', 'by', 'limit', 'offset', 'query', 'start_date', 'end_date']);
        $top = ($params['bucket'] ?? '') === 'top';

        $res = $top
            ? $this->of->listTopFans($acct, $params)
            : $this->of->listFans($acct, $params['bucket'] ?? 'active', $params);

        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();
        $rows = data_get($j, 'data.list') ?? data_get($j, 'data.users') ?? [];

        return response()->json([
            'fans' => collect($rows)->map(fn ($f) => $this->of->normalizeFan($f))->values(),
            'hasMore' => (bool) data_get($j, 'data.hasMore', false),
            'next' => $this->of->nextCursor($j['_pagination'] ?? null),
        ]);
    }

    /**
     * All-time spenders for the agency Spender-Brackets page: pages `fans/all` filtered
     * to `filter[total_spent] >= floor` (so only the whales are pulled) and returns the
     * full list for client-side bucketing. Cached briefly per (account, floor) as a cost
     * guard; `?fresh=1` (the Refresh button) bypasses the cache.
     */
    public function spenders(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, ['floor' => 'nullable|numeric|min:0']);
        $floor = (int) ($data['floor'] ?? 200);

        // Bump the version tag whenever the cached payload shape changes (e.g. new
        // normalizeFan fields) so warm caches don't serve stale-shaped rows.
        $key = "of_spenders:v2:{$acct}:{$floor}";
        if ($request->boolean('fresh')) {
            Cache::forget($key);
        }
        if (($cached = Cache::get($key)) !== null) {
            return response()->json($cached);
        }

        $spenders = [];
        $offset = 0;
        $pages = 0;
        $maxPages = 200;
        $truncated = false;

        do {
            $res = $this->of->listFans($acct, 'all', [
                'filter' => ['total_spent' => $floor],
                'limit' => 20,
                'offset' => $offset,
            ]);
            if (! $res->successful()) {
                return $this->forward($res);
            }

            $j = $res->json();
            $rows = data_get($j, 'data.list') ?? data_get($j, 'data.users') ?? [];
            foreach ($rows as $f) {
                $spenders[] = $this->of->normalizeFan($f);
            }

            $hasMore = (bool) data_get($j, 'data.hasMore', false);
            $offset += 20;
            $pages++;
            if ($pages >= $maxPages && $hasMore) {
                $truncated = true;
                break;
            }
        } while ($hasMore);

        $payload = [
            'spenders' => $spenders,
            'floor' => $floor,
            'count' => count($spenders),
            'truncated' => $truncated,
        ];
        Cache::put($key, $payload, 300);

        return response()->json($payload);
    }

    public function fanHistory(AichModel $model, string $fan): JsonResponse
    {
        $res = $this->of->getFanSubscriptionHistory($this->account($model), $fan);
        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'history' => collect(data_get($res->json(), 'data.list', []))->map(fn ($r) => [
                'subscribeDate' => $r['subscribeDate'] ?? null,
                'expireDate' => $r['expireDate'] ?? null,
                'price' => (float) ($r['price'] ?? 0),
            ])->values(),
        ]);
    }

    /** Account flags (read-only) + the editable profile identity, pulled from /me. */
    public function settings(AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $res = $this->of->getSettings($acct);
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $s = $res->json('data') ?? [];

        $me = $this->of->getMe($acct);
        $p = $me->successful() ? ($me->json('data') ?? []) : [];

        return response()->json([
            'settings' => [
                'isPrivate' => (bool) ($s['isPrivate'] ?? false),
                'isDrmEnabled' => (bool) ($s['isDrmEnabled'] ?? false),
                'hasPaidPosts' => (bool) ($s['hasPaidPosts'] ?? false),
                'blockedCountriesCount' => is_array($s['blockedCountries'] ?? null) ? count($s['blockedCountries']) : 0,
            ],
            'profile' => [
                'name' => $p['name'] ?? null,
                'about' => $this->of->htmlToText($p['about'] ?? ''),
                'location' => $p['location'] ?? null,
                'website' => $p['website'] ?? null,
                'wishlist' => $p['wishlist'] ?? null,
                'subscribePrice' => $p['subscribePrice'] ?? null,
            ],
        ]);
    }

    public function updateProfile(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $fields = ['name', 'about', 'location', 'website', 'wishlist'];
        $this->validateJson($request, [
            'name' => 'nullable|string|max:255',
            'about' => 'nullable|string|max:1000',
            'location' => 'nullable|string|max:255',
            'website' => 'nullable|string|max:255',
            'wishlist' => 'nullable|string|max:255',
        ]);
        // Only forward keys the client actually sent (so unsent fields aren't cleared).
        $payload = $request->only($fields);
        if (empty($payload)) {
            return response()->json(['error' => 'No profile fields to update.'], 422);
        }

        $res = $this->of->updateProfile($acct, $payload);

        return $res->successful() ? response()->json(['ok' => true]) : $this->forward($res);
    }

    public function updateSubscriptionPrice(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, ['price' => ['required', 'string']]);

        $price = $data['price'];
        if (! in_array($price, ['0', 'free'], true) && (! is_numeric($price) || $price < 4.99 || $price > 200)) {
            return response()->json(['error' => 'Price must be 0, "free", or between 4.99 and 200.'], 422);
        }

        $res = $this->of->updateSubscriptionPrice($acct, $price);

        return $res->successful() ? response()->json(['ok' => true]) : $this->forward($res);
    }

    public function welcomeMessage(AichModel $model): JsonResponse
    {
        $res = $this->of->getWelcomeMessage($this->account($model));

        return $res->successful()
            ? response()->json(['welcome' => $this->of->normalizeWelcomeMessage($res->json('data') ?? [])])
            : $this->forward($res);
    }

    public function updateWelcomeMessage(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, [
            'text' => 'required|string',
            'lockedText' => 'nullable|boolean',
        ]);

        $res = $this->of->updateWelcomeMessage($acct, collect($data)->filter(fn ($v) => $v !== null)->all());

        return $res->successful() ? response()->json(['ok' => true]) : $this->forward($res);
    }

    public function toggleWelcomeMessage(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, ['enabled' => 'required|boolean']);

        $res = $this->of->setWelcomeMessageEnabled($acct, $data['enabled']);

        return $res->successful() ? response()->json(['ok' => true]) : $this->forward($res);
    }

    // ---- Notifications ----------------------------------------------------

    public function notifications(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $params = $request->only(['type', 'limit', 'from_id', 'skip_users']);
        // OnlyFans 400s on an explicit `type=all` — "all" means the unfiltered feed, so omit it.
        if (($params['type'] ?? null) === 'all') {
            unset($params['type']);
        }
        $res = $this->of->listNotifications($acct, $params);
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $rows = collect(data_get($res->json(), 'data.list', []))->map(fn ($n) => $this->of->normalizeNotification($n))->values();

        return response()->json([
            'notifications' => $rows,
            'hasMore' => (bool) data_get($res->json(), 'data.hasMore', false),
            'next' => $rows->last()['id'] ?? null,
        ]);
    }

    public function notificationCounts(AichModel $model): JsonResponse
    {
        $res = $this->of->getNotificationCounts($this->account($model));

        return $res->successful()
            ? response()->json(['counts' => $res->json('data') ?? []])
            : $this->forward($res);
    }

    public function markNotificationsRead(AichModel $model): JsonResponse
    {
        return $this->proxyAction($this->of->markAllNotificationsRead($this->account($model)));
    }

    // ---- Users · lookup + moderation --------------------------------------

    /** Users this creator has blocked on OnlyFans. */
    public function blockedUsers(Request $request, AichModel $model): JsonResponse
    {
        return $this->moderatedUsers($request, $model, blocked: true);
    }

    /** Users this creator has restricted on OnlyFans. */
    public function restrictedUsers(Request $request, AichModel $model): JsonResponse
    {
        return $this->moderatedUsers($request, $model, blocked: false);
    }

    /**
     * Both moderation lists return the same paginated user shape, so they share a mapper.
     * Pagination is driven by `hasMore` + `nextOffset`, NOT `_pagination.next_page`: the
     * blocked/restricted endpoints return a next_page url even on the last page.
     */
    private function moderatedUsers(Request $request, AichModel $model, bool $blocked): JsonResponse
    {
        $acct = $this->account($model);
        $params = $request->only(['limit', 'offset', 'query']);

        $res = $blocked
            ? $this->of->listBlockedUsers($acct, $params)
            : $this->of->listRestrictedUsers($acct, $params);

        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'users' => collect(data_get($j, 'data.list') ?? [])
                ->map(fn ($u) => $this->of->normalizeUserDetail($u))
                ->values(),
            'hasMore' => (bool) data_get($j, 'data.hasMore', false),
            'nextOffset' => data_get($j, 'data.nextOffset'),
        ]);
    }

    public function userDetail(AichModel $model, string $user): JsonResponse
    {
        $res = $this->of->getUser($this->account($model), $user);

        return $res->successful()
            ? response()->json(['user' => $this->of->normalizeUserDetail($res->json('data') ?? [])])
            : $this->forward($res);
    }

    /** Mass-fetch up to 10 users by numeric id in one call. */
    public function userList(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        // Accept `ids` as a comma string or an array; normalise to a clean numeric-ish list (max 10).
        $raw = $request->input('ids', []);
        $ids = collect(is_array($raw) ? $raw : explode(',', (string) $raw))
            ->map(fn ($v) => trim((string) $v))
            ->filter()
            ->unique()
            ->take(10)
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['error' => 'Provide up to 10 comma-separated user ids.'], 422);
        }

        $res = $this->of->listUserDetails($acct, $ids->all());
        if (! $res->successful()) {
            return $this->forward($res);
        }

        // `data` is an object keyed by user id; flatten to a normalised list (skip non-object entries).
        $users = collect($res->json('data') ?? [])
            ->filter(fn ($u) => is_array($u))
            ->map(fn ($u) => $this->of->normalizeUserDetail($u))
            ->values();

        return response()->json(['users' => $users]);
    }

    public function block(AichModel $model, string $user): JsonResponse
    {
        return $this->userAction($this->of->blockUser($this->account($model), $user));
    }

    public function unblock(AichModel $model, string $user): JsonResponse
    {
        return $this->userAction($this->of->unblockUser($this->account($model), $user));
    }

    public function restrict(AichModel $model, string $user): JsonResponse
    {
        return $this->userAction($this->of->restrictUser($this->account($model), $user));
    }

    public function unrestrict(AichModel $model, string $user): JsonResponse
    {
        return $this->userAction($this->of->unrestrictUser($this->account($model), $user));
    }

    public function subscribe(AichModel $model, string $user): JsonResponse
    {
        return $this->userAction($this->of->subscribeToUser($this->account($model), $user));
    }

    public function unsubscribe(AichModel $model, string $user): JsonResponse
    {
        return $this->userAction($this->of->unsubscribeFromUser($this->account($model), $user));
    }

    // ---- Tracking links ---------------------------------------------------

    public function trackingLinks(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $res = $this->of->listTrackingLinks($acct, $request->only(['limit', 'offset', 'sortby', 'sort', 'with_deleted', 'startDate', 'endDate']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'links' => collect(data_get($j, 'data.list', []))->map(fn ($l) => $this->of->normalizeTrackingLink($l))->values(),
            'hasMore' => (bool) data_get($j, 'data.hasMore', false),
            'next' => $this->of->nextCursor($j['_pagination'] ?? null),
        ]);
    }

    public function createTrackingLink(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, [
            'name' => 'required|string|max:120',
            'tags' => 'nullable|array',
            'tags.*' => 'string|max:60',
        ]);

        return $this->userAction($this->of->createTrackingLink($acct, collect($data)->filter()->all()));
    }

    public function deleteTrackingLink(AichModel $model, string $link): JsonResponse
    {
        return $this->proxyAction($this->of->deleteTrackingLink($this->account($model), $link));
    }

    public function trackingLinkStats(AichModel $model, string $link): JsonResponse
    {
        $res = $this->of->getTrackingLinkStats($this->account($model), $link);

        return $res->successful()
            ? response()->json(['stats' => $this->of->normalizeLinkStats($res->json('data') ?? [])])
            : $this->forward($res);
    }

    // ---- Free-trial links -------------------------------------------------

    public function trialLinks(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $res = $this->of->listTrialLinks($acct, $request->only(['limit', 'offset', 'sort', 'field']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'links' => collect(data_get($j, 'data.list', []))->map(fn ($l) => $this->of->normalizeTrialLink($l))->values(),
            'hasMore' => (bool) data_get($j, 'data.hasMore', false),
            'next' => $this->of->nextCursor($j['_pagination'] ?? null),
        ]);
    }

    public function createTrialLink(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, [
            'duration' => 'required|integer|in:1,3,7,14,30,90,180,360',
            'offerExpiration' => 'required|integer|min:0|max:30',
            'offerLimit' => 'required|integer|in:0,1,2,3,4,5,6,7,8,9,10,50,100',
            'name' => 'nullable|string|max:64',
            'tags' => 'nullable|array',
            'tags.*' => 'string|max:60',
        ]);

        return $this->userAction($this->of->createTrialLink($acct, collect($data)->filter(fn ($v) => $v !== null)->all()));
    }

    public function deleteTrialLink(AichModel $model, string $link): JsonResponse
    {
        return $this->proxyAction($this->of->deleteTrialLink($this->account($model), $link));
    }

    public function trialLinkStats(AichModel $model, string $link): JsonResponse
    {
        $res = $this->of->getTrialLinkStats($this->account($model), $link);

        return $res->successful()
            ? response()->json(['stats' => $this->of->normalizeLinkStats($res->json('data') ?? [])])
            : $this->forward($res);
    }

    // ---- Smart links ------------------------------------------------------
    // List/create are scoped to this creator's account; per-link operations
    // address the smart_link_id directly (the route is still manage-team gated).

    public function smartLinks(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $res = $this->of->listSmartLinks($acct, $request->only(['limit', 'offset', 'name']));
        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'links' => collect($res->json('data') ?? [])->map(fn ($l) => $this->of->normalizeSmartLink($l))->values(),
        ]);
    }

    public function createSmartLink(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, [
            'name' => 'required|string|max:120',
            'link_type' => 'required|string|in:free_trial,tracking_link',
            'free_trial_days' => 'nullable|integer|min:1|max:360|required_if:link_type,free_trial',
        ]);

        return $this->userAction($this->of->createSmartLink($acct, collect($data)->filter(fn ($v) => $v !== null)->all()));
    }

    public function deleteSmartLink(AichModel $model, string $link): JsonResponse
    {
        $this->account($model);

        return $this->proxyAction($this->of->deleteSmartLink($link));
    }

    public function smartLinkStats(Request $request, AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $res = $this->of->getSmartLinkStats($link, $request->only(['date_start', 'date_end']));

        return $res->successful()
            ? response()->json(['stats' => $this->of->normalizeLinkStats($res->json('data') ?? [])])
            : $this->forward($res);
    }

    public function smartLinkFans(Request $request, AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $res = $this->of->listSmartLinkFans($link, $request->only(['limit', 'offset', 'sort', 'has_messages', 'min_messages_sent_by_fan', 'min_revenue_net', 'min_tips_net']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'summary' => [
                'fansTotal' => (int) data_get($j, 'data.summary.fans_total', 0),
                'revenueNetTotal' => (float) data_get($j, 'data.summary.revenue_net_total', 0),
                'tipsNetTotal' => (float) data_get($j, 'data.summary.tips_net_total', 0),
            ],
            'rows' => collect(data_get($j, 'data.rows', []))->map(fn ($f) => $this->of->normalizeSmartLinkFan($f))->values(),
        ]);
    }

    public function smartLinkSpenders(Request $request, AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $res = $this->of->listSmartLinkSpenders($link, $request->only(['limit', 'offset', 'minSpend']));
        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'rows' => collect($res->json('data') ?? [])->map(fn ($s) => $this->of->normalizeSmartLinkSpender($s))->values(),
        ]);
    }

    public function smartLinkClicks(Request $request, AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $res = $this->of->listSmartLinkClicks($link, $request->only(['date_start', 'date_end', 'limit', 'offset', 'include_bots', 'include_duplicates']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'total' => (int) data_get($j, 'data.summary.clicks_total', 0),
            'rows' => collect(data_get($j, 'data.rows', []))->map(fn ($c) => $this->of->normalizeSmartLinkClick($c))->values(),
        ]);
    }

    public function smartLinkConversions(Request $request, AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $res = $this->of->listSmartLinkConversions($link, $request->only(['date_start', 'date_end', 'limit', 'offset', 'include_bots', 'include_duplicates', 'conversion_type', 'onlyfans_user_id']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'summary' => [
                'conversionsTotal' => (int) data_get($j, 'data.summary.conversions_total', 0),
                'subscribersTotal' => (int) data_get($j, 'data.summary.subscribers_total', 0),
                'revenueTotal' => (float) data_get($j, 'data.summary.revenue_total', 0),
            ],
            'rows' => collect(data_get($j, 'data.rows', []))->map(fn ($c) => $this->of->normalizeSmartLinkConversion($c))->values(),
        ]);
    }

    public function smartLinkTags(AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $res = $this->of->listSmartLinkTags($link);

        return $res->successful()
            ? response()->json(['tags' => array_values($res->json('tags') ?? [])])
            : $this->forward($res);
    }

    public function addSmartLinkTags(Request $request, AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $data = $this->validateJson($request, ['tags' => 'required|array', 'tags.*' => 'string|max:60']);
        $res = $this->of->addSmartLinkTags($link, $data['tags']);

        return $res->successful()
            ? response()->json(['tags' => array_values($res->json('tags') ?? [])])
            : $this->forward($res);
    }

    public function removeSmartLinkTags(Request $request, AichModel $model, string $link): JsonResponse
    {
        $this->account($model);
        $data = $this->validateJson($request, ['tags' => 'required|array', 'tags.*' => 'string|max:60']);
        $res = $this->of->removeSmartLinkTags($link, $data['tags']);

        return $res->successful()
            ? response()->json(['tags' => array_values($res->json('tags') ?? [])])
            : $this->forward($res);
    }

    // ---- Link tags --------------------------------------------------------

    public function linkTags(Request $request, AichModel $model): JsonResponse
    {
        $this->account($model);
        $res = $this->of->listLinkTags($request->only(['type']));

        return $res->successful()
            ? response()->json(['tags' => array_values(data_get($res->json(), 'data.tags', []))])
            : $this->forward($res);
    }

    // ---- Promotions -------------------------------------------------------

    public function promotions(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $res = $this->of->listPromotions($acct, $request->only(['limit', 'offset']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'promotions' => collect(data_get($j, 'data.items', []))->map(fn ($p) => $this->of->normalizePromotion($p))->values(),
            'hasMore' => (bool) data_get($j, 'data.hasMore', false),
        ]);
    }

    public function createPromotion(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, [
            'type' => 'required|string|in:new,expired,new_and_expired',
            'discount' => 'required|integer|min:0|max:100',
            'offerLimit' => 'required|integer|min:0',
            'expirationDays' => 'required|integer|min:1',
            'freeTrialDays' => 'required_if:discount,100|nullable|integer|min:0',
            'message' => 'nullable|string|max:1000',
        ]);

        return $this->userAction($this->of->createPromotion($acct, collect($data)->filter(fn ($v) => $v !== null && $v !== '')->all()));
    }

    public function stopPromotion(AichModel $model, string $promotion): JsonResponse
    {
        return $this->proxyAction($this->of->stopPromotion($this->account($model), $promotion));
    }

    public function deletePromotion(AichModel $model, string $promotion): JsonResponse
    {
        return $this->proxyAction($this->of->deletePromotion($this->account($model), $promotion));
    }

    // ---- Subscription bundles ---------------------------------------------

    public function bundles(AichModel $model): JsonResponse
    {
        $res = $this->of->listBundles($this->account($model));

        return $res->successful()
            ? response()->json(['bundles' => collect(data_get($res->json(), 'data', []))->map(fn ($b) => $this->of->normalizeBundle($b))->values()])
            : $this->forward($res);
    }

    public function createBundle(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($model);
        $data = $this->validateJson($request, [
            'discount' => 'required|integer|in:0,5,10,15,20,25,30,35,40,45,50',
            'duration' => 'required|integer|in:3,6,12',
        ]);

        return $this->userAction($this->of->createBundle($acct, $data));
    }

    public function deleteBundle(AichModel $model, string $bundle): JsonResponse
    {
        return $this->proxyAction($this->of->deleteBundle($this->account($model), $bundle));
    }

    // ---- helpers ----------------------------------------------------------

    /** Resolve the model's OnlyFans account id (access is already manage-team gated by the route). */
    private function account(AichModel $model): string
    {
        if (! $this->of->enabled()) {
            abort(503, 'OnlyFans API key is not configured.');
        }
        if (! $model->of_account_id) {
            abort(422, "Creator {$model->name} has no OnlyFans account connected.");
        }

        return $model->of_account_id;
    }

    /** ok + the upstream `data` payload (actions that return the updated entity: block/restrict/subscribe, create link). */
    private function userAction(Response $res): JsonResponse
    {
        return $res->successful()
            ? response()->json(['ok' => true, 'data' => $res->json('data')])
            : $this->forward($res);
    }

    /**
     * Validate and return the data, or throw a JSON 422. These fetch-based endpoints
     * are not under `api/*`, so the app's exception handler would otherwise turn a
     * ValidationException into a 302 redirect (see bootstrap/app.php shouldRenderJsonWhen);
     * an HttpResponseException is returned verbatim, guaranteeing JSON for the client.
     *
     * @param  array<string, mixed>  $rules
     * @return array<string, mixed>
     */
    private function validateJson(Request $request, array $rules): array
    {
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            throw new HttpResponseException(
                response()->json(['error' => $validator->errors()->first(), 'errors' => $validator->errors()->toArray()], 422)
            );
        }

        return $validator->validated();
    }
}
