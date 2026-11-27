<?php

namespace App\Services\Integrations;

use App\Models\AichModel;
use App\Models\AppSetting;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;

/**
 * Which backend every OnlyFans call goes through: OnlyFansAPI, or OopCRM's OFAPI-compatible
 * layer. Both speak the same API, so switching only changes the base URL, the key and the
 * webhook secret OnlyFansService uses. One agency-wide setting (Settings → Integrations,
 * admin only); keys stay in config/.env and never reach the browser. Creators keep the same
 * `of_account_id` on both sides only if their OnlyFansAPI ids are registered in OopCRM's
 * OFAPI migration tab.
 */
class ChatProvider
{
    public const ONLYFANSAPI = 'onlyfansapi';

    public const OOPCRM = 'oopcrm';

    public const ALL = [self::ONLYFANSAPI, self::OOPCRM];

    public const LABELS = [self::ONLYFANSAPI => 'OnlyFansAPI', self::OOPCRM => 'OOP CRM'];

    private const SETTING = 'chat_provider';

    private const CACHE_KEY = 'app_settings.chat_provider';

    /** The active provider: the admin's choice, else CHAT_PROVIDER, else OnlyFansAPI. */
    public function active(): string
    {
        $stored = Cache::rememberForever(self::CACHE_KEY, function () {
            // A fresh install (or a test without the migration) has no table yet.
            if (! Schema::hasTable('app_settings')) {
                return null;
            }

            return AppSetting::query()->whereKey(self::SETTING)->value('value');
        });

        if (in_array($stored, self::ALL, true)) {
            return $stored;
        }

        $fallback = (string) config('services.chat_provider', self::ONLYFANSAPI);

        return in_array($fallback, self::ALL, true) ? $fallback : self::ONLYFANSAPI;
    }

    public function set(string $provider, ?int $userId = null): void
    {
        if (! in_array($provider, self::ALL, true)) {
            throw new InvalidArgumentException("Unknown chat provider [{$provider}].");
        }

        AppSetting::query()->updateOrCreate(
            ['key' => self::SETTING],
            ['value' => $provider, 'updated_by' => $userId],
        );

        Cache::forget(self::CACHE_KEY);
    }

    /** @return array{key: string, base_url: string, webhook_secret: string} */
    public function connection(?string $provider = null): array
    {
        $provider ??= $this->active();
        $section = $provider === self::OOPCRM ? 'oopcrm' : 'onlyfans';
        $defaultBase = $provider === self::OOPCRM ? 'https://app.oopcrm.com/api/v1/ofapi' : 'https://app.onlyfansapi.com/api';

        return [
            'key' => (string) config("services.{$section}.key"),
            'base_url' => rtrim((string) config("services.{$section}.base_url") ?: $defaultBase, '/'),
            'webhook_secret' => (string) config("services.{$section}.webhook_secret"),
        ];
    }

    public function configured(string $provider): bool
    {
        return $this->connection($provider)['key'] !== '';
    }

    /**
     * Refuse to call OnlyFans for a creator connected through the provider that ISN'T active:
     * its account id means nothing on this transport (OopCRM answers an OnlyFansAPI id with 403
     * "Creator access is unavailable"), so say what's actually wrong instead.
     */
    public function ensureServes(AichModel $model): void
    {
        if ($model->onActiveProvider()) {
            return;
        }

        // JSON, not abort(): these routes sit outside api/*, where an HttpException renders as an
        // HTML page and the fetch client would lose the message.
        throw new HttpResponseException(response()->json([
            'error' => 'PROVIDER_MISMATCH',
            'message' => sprintf(
                '%s is connected through %s, but chats run through %s right now. An admin can switch providers in Settings → Integrations.',
                $model->name,
                self::LABELS[$model->provider] ?? $model->provider,
                self::LABELS[$this->active()],
            ),
        ], 409));
    }

    /** A client pinned to one provider, whichever is active (the Creator Models page lists both). */
    public function service(string $provider): OnlyFansService
    {
        $connection = $this->connection($provider);

        return new OnlyFansService($connection['key'], $connection['base_url']);
    }

    /** Every non-empty webhook signing secret, so deliveries from either side verify. */
    public function webhookSecrets(): array
    {
        return array_values(array_filter(array_unique([
            $this->connection(self::ONLYFANSAPI)['webhook_secret'],
            $this->connection(self::OOPCRM)['webhook_secret'],
        ])));
    }
}
