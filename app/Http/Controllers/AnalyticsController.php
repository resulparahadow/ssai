<?php

namespace App\Http\Controllers;

use App\Models\AichModel;
use App\Models\User;
use App\Services\OnlyFans\OnlyFansService;
use App\Support\CreatorContext;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;
use RuntimeException;

/**
 * Agency-wide OnlyFans Analytics dashboard — a LIVE proxy, nothing is persisted.
 * Manager/admin only (routes gated by `manage-team`). The OnlyFansAPI Analytics
 * endpoints operate over an `account_ids[]` array (no per-account path segment),
 * so each JSON method allow-lists the submitted ids against the caller's connected
 * accounts before forwarding, then passes the upstream body/status straight through.
 */
class AnalyticsController extends Controller
{
    public function __construct(protected OnlyFansService $of) {}

    /** The dashboard shell; the sections fetch live client-side via lib/ofAnalytics.ts. */
    public function page(Request $request): InertiaResponse
    {
        return Inertia::render('Analytics', [
            'accounts' => $this->connectedAccounts($request->user()),
        ]);
    }

    // ---- Summary ----------------------------------------------------------

    public function earnings(Request $request): JsonResponse
    {
        $data = $this->validateJson($request, $this->dateRangeRules());
        $data['account_ids'] = $this->allowedIds($request);

        return $this->forwardData(fn () => $this->of->earningsOverview($data));
    }

    public function historical(Request $request): JsonResponse
    {
        $data = $this->validateJson($request, [
            'time_range' => 'nullable|string|in:3m,6m,12m,ytd,last-year',
        ]);

        return $this->forwardData(fn () => $this->of->historicalPerformance($data));
    }

    public function comparison(Request $request): JsonResponse
    {
        $data = $this->validateJson($request, [
            'period_a' => 'required|array',
            'period_a.start' => 'required|date',
            'period_a.end' => 'required|date|after_or_equal:period_a.start',
            'period_b' => 'required|array',
            'period_b.start' => 'required|date',
            'period_b.end' => 'required|date|after_or_equal:period_b.start',
            'granularity' => 'nullable|string|in:months,quarters,half_years,years',
            'stat_type' => 'nullable|string|in:totalEarnings,subscriptions,posts,messages,tips,streams',
        ]);
        $data['account_ids'] = $this->allowedIds($request);

        return $this->forwardData(fn () => $this->of->periodComparison($data));
    }

    // ---- Financial --------------------------------------------------------

    public function transactionSummary(Request $request): JsonResponse
    {
        $data = $this->validateJson($request, $this->dateRangeRules());
        $data['account_ids'] = $this->allowedIds($request);

        return $this->forwardData(fn () => $this->of->transactionSummary($data));
    }

    public function transactionsByType(Request $request): JsonResponse
    {
        $data = $this->validateJson($request, $this->dateRangeRules());
        $data['account_ids'] = $this->allowedIds($request);

        return $this->forwardData(fn () => $this->of->transactionsByType($data));
    }

    public function forecast(Request $request): JsonResponse
    {
        $data = $this->validateJson($request, [
            'metric' => 'required|string|in:revenue,churn_percentage',
            'model' => 'required|string|in:moving_average,linear_regression,arima,sarima',
            'historical_days' => 'required|integer|min:30|max:730',
            'forecast_days' => 'required|integer|min:7|max:365',
        ]);
        $data['account_ids'] = $this->allowedIds($request);

        return $this->forwardData(fn () => $this->of->revenueForecast($data));
    }

    public function profitability(Request $request): JsonResponse
    {
        $data = $this->validateJson($request, [
            'year' => 'required|integer|min:2015|max:2100',
            'month' => 'required|integer|min:1|max:12',
        ]);
        $data['account_ids'] = $this->allowedIds($request);

        return $this->forwardData(fn () => $this->of->profitability($data));
    }

    public function profitabilityHistory(Request $request, AichModel $model): JsonResponse
    {
        $account = $this->account($model);
        $params = [
            'account_prefixed_id' => $account,
            'months' => $request->query('months'),
        ];

        return $this->forwardData(fn () => $this->of->profitabilityHistory($account, $params));
    }

    // ---- helpers ----------------------------------------------------------

    /** @return array<string, string> */
    private function dateRangeRules(): array
    {
        return [
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
        ];
    }

    /**
     * The `of_account_id`s the caller may analyze. Managers/admins see every
     * connected creator; a chatter would only see their assignments (defence in
     * depth — the route is manage-team gated so only managers/admins reach here).
     *
     * @return list<string>
     */
    private function connectedIds(User $user): array
    {
        $q = AichModel::query()->whereNotNull('of_account_id');
        if (! $user->canSeeAllCreators()) {
            $q->whereIn('name', $user->assignedCreatorModels());
        }

        return $q->pluck('of_account_id')->filter()->values()->all();
    }

    /**
     * Connected creators for the dashboard account picker.
     *
     * @return list<array{id:int, name:string, accountId:string}>
     */
    private function connectedAccounts(?User $user): array
    {
        if (! $user) {
            return [];
        }

        $q = AichModel::query()->whereNotNull('of_account_id')->orderBy('name');
        if (! $user->canSeeAllCreators()) {
            $q->whereIn('name', $user->assignedCreatorModels());
        }

        return $q->get(['id', 'name', 'of_account_id'])
            ->map(fn (AichModel $m) => [
                'id' => $m->id,
                'name' => $m->name,
                'accountId' => (string) $m->of_account_id,
            ])
            ->all();
    }

    /**
     * Validate the request's `account_ids` against the caller's connected set. A
     * missing/empty selection defaults to all connected accounts; any id the caller
     * cannot access is a 422 (never forwarded to OnlyFans).
     *
     * @return list<string>
     */
    private function allowedIds(Request $request): array
    {
        $allowed = $this->connectedIds($request->user());
        if (empty($allowed)) {
            $this->fail('No OnlyFans accounts are connected.');
        }

        // Clamp to the app-wide creator context: when a single creator is selected (not "All
        // creators"), the allowed set shrinks to that creator's account, so a crafted
        // account_ids[] can't reach another creator's data.
        $contextName = app(CreatorContext::class)->selectedNameForRequest($request);
        if ($contextName !== null) {
            $ofId = AichModel::query()->where('name', $contextName)->value('of_account_id');
            $allowed = $ofId ? array_values(array_intersect($allowed, [(string) $ofId])) : [];
            if (empty($allowed)) {
                $this->fail('The selected creator has no OnlyFans account connected.');
            }
        }

        $requested = array_values(array_filter((array) $request->input('account_ids', [])));
        if (empty($requested)) {
            return $allowed;
        }

        $unknown = array_diff($requested, $allowed);
        if (! empty($unknown)) {
            $this->fail('One or more selected accounts are not available.');
        }

        return array_values(array_intersect($requested, $allowed));
    }

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

    /**
     * Run the OnlyFans call and shape the response. Upstream non-2xx is forwarded
     * with its status/body; a config/connection failure (unreachable OnlyFans,
     * missing key) becomes a clean 503 the UI can render — never a bare 500.
     *
     * @param  \Closure(): Response  $call
     */
    private function forwardData(\Closure $call): JsonResponse
    {
        try {
            $res = $call();
        } catch (ConnectionException $e) {
            return response()->json([
                'error' => 'Could not reach OnlyFans (timeout). Please try again.',
                'source' => 'onlyfans',
            ], 503);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage(), 'source' => 'config'], 503);
        }

        if ($res->successful()) {
            // Analytics endpoints return the payload at the top level (object or array).
            return response()->json(['data' => $res->json()]);
        }

        $status = $res->status();
        $body = $res->json();
        $upstream = is_array($body) ? ($body['message'] ?? $body['error'] ?? null) : null;

        // 5xx from OnlyFans = their side is failing. Surface it as such (not a bare
        // SmartStars 500) so the UI can badge it "OnlyFans API error".
        if ($status >= 500) {
            return response()->json([
                'error' => "OnlyFans's API returned an error (HTTP {$status})".
                    ($upstream ? ": {$upstream}" : '.').
                    " This is a problem on OnlyFans's side, not SmartStars — please try again later.",
                'source' => 'onlyfans',
                'upstreamStatus' => $status,
            ], 502);
        }

        // 4xx = actionable (invalid accounts, validation): forward OnlyFans's own message.
        return response()->json([
            'error' => $upstream ?: 'OnlyFans rejected the request.',
            'source' => 'onlyfans',
            'upstreamStatus' => $status,
            'errors' => is_array($body) ? ($body['errors'] ?? null) : null,
        ], $status);
    }

    private function fail(string $message): never
    {
        throw new HttpResponseException(response()->json(['error' => $message], 422));
    }

    /**
     * Validate and return the data, or throw a JSON 422 (these fetch endpoints are
     * not under `api/*`, so a ValidationException would otherwise 302-redirect —
     * see bootstrap/app.php shouldRenderJsonWhen).
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
