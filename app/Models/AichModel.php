<?php

namespace App\Models;

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
        'timezone',
        'is_bilingual',
        'price_ladder',
    ];

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
