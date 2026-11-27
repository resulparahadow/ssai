<?php

namespace App\Models;

use App\Services\Integrations\ChatProvider;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Creator persona + content library. `name` is the isolation boundary that
 * `creator_model` string columns elsewhere refer to. `content_library` and
 * `feedback_rules` are freeform text the manager edits in the Models settings.
 */
class AichModel extends Model
{
    protected $table = 'aich_models';

    protected $fillable = [
        'name',
        'prompt',
        'content_library',
        'feedback_rules',
        'tier',
        'of_account_id',
        'provider',
        'timezone',
        'is_bilingual',
        'price_ladder',
    ];

    /**
     * `provider` follows `of_account_id`: an id set without naming its provider belongs to the
     * active one (that's the transport it was entered for), and clearing the id clears it.
     * Callers that know better (Add as creator model, the Creator Models sync) set it explicitly.
     */
    protected static function booted(): void
    {
        static::saving(function (AichModel $model): void {
            if (! $model->isDirty('of_account_id') || $model->isDirty('provider')) {
                return;
            }

            $model->provider = filled($model->of_account_id) ? app(ChatProvider::class)->active() : null;
        });
    }

    /**
     * Creators the app works with right now: those whose OnlyFans account is connected through
     * the active provider. A creator on the OTHER provider is hidden everywhere (its account id
     * doesn't work on this transport), and so is a model with no account yet — it has no chats,
     * fans or vault to show; it stays reachable on the Creator Models page.
     *
     * @param  Builder<AichModel>  $query
     */
    public function scopeOnActiveProvider(Builder $query): void
    {
        $query->where('provider', app(ChatProvider::class)->active())
            ->whereNotNull('of_account_id')
            ->where('of_account_id', '!=', '');
    }

    /** Whether this creator's account works on the active provider (or it has no account). */
    public function onActiveProvider(): bool
    {
        return blank($this->of_account_id) || $this->provider === null
            || $this->provider === app(ChatProvider::class)->active();
    }

    /** The team's Master Script ladder — the default when a creator has no ladder of her own. */
    public const DEFAULT_PRICE_LADDER = [12, 21, 35, 49, 69, 100];

    protected $casts = [
        'is_bilingual' => 'boolean',
        'price_ladder' => 'array',
    ];

    /** @return list<int|float> the creator's PPV price ladder, ascending (suggestions only — never auto-applied). */
    public function priceLadder(): array
    {
        $ladder = array_values(array_filter(
            array_map(fn ($p) => is_numeric($p) ? $p + 0 : null, (array) ($this->price_ladder ?? [])),
            fn ($p) => $p !== null && $p > 0,
        ));
        sort($ladder);

        return $ladder !== [] ? $ladder : self::DEFAULT_PRICE_LADDER;
    }

    /** The IANA zone the engine's clock runs in for this creator — theirs, else the agency default. */
    public function timezoneOrDefault(): string
    {
        return $this->timezone ?: (string) config('services.engine.default_timezone', 'UTC');
    }

    /** Assignments are matched on the creator name, not a FK (legacy convention). */
    public function assignments(): HasMany
    {
        return $this->hasMany(ModelAssignment::class, 'creator_model', 'name');
    }
}
