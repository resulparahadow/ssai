<?php

namespace App\Services\OnlyFans;

/**
 * The fan's AI memory (`customer_profiles.key_details`) as a log of dated entries, one per
 * conversation, in legacy writeSessionMemory's format: "[Sep 28, 2026] …", a blank line
 * between entries. Each generate's summary rewrites only the CURRENT conversation's entry;
 * a new conversation appends one, so older facts are never overwritten. Pure — the caller
 * decides whether the conversation continues and formats the date.
 */
final class FanMemoryLog
{
    /** Stored-log ceiling; the oldest entries go first. Also the manual-edit max (PATCH /profile). */
    public const MAX_CHARS = 60000;

    /** How much of the log the AI is shown per generate — the newest entries, so cost stays flat. */
    public const ENGINE_CHARS = 3000;

    private const SEPARATOR = "\n\n";

    private const HEADER = '/^\[[^\]\n]{1,40}\] /';

    /** Rewrite the current entry ($continues) or append a new "[$date] …" one. */
    public static function record(?string $log, string $summary, string $date, bool $continues): string
    {
        // Entries are split on blank lines, so the summary must not contain any.
        $summary = trim((string) preg_replace('/\s+/u', ' ', $summary));
        $entries = self::entries($log);
        $last = $entries === [] ? null : $entries[count($entries) - 1];

        if ($continues && $last !== null && preg_match(self::HEADER, $last, $m)) {
            $entries[count($entries) - 1] = $m[0].$summary;
        } elseif ($last === null || preg_replace(self::HEADER, '', $last, 1) !== $summary) {
            $entries[] = "[{$date}] {$summary}";
        }

        return self::newest($entries, self::MAX_CHARS);
    }

    /** The newest whole entries that fit in $limit characters — what the AI is shown. */
    public static function recent(?string $log, int $limit = self::ENGINE_CHARS): string
    {
        return self::newest(self::entries($log), $limit);
    }

    /** @return list<string> */
    private static function entries(?string $log): array
    {
        $blocks = preg_split('/\n\s*\n/', trim((string) $log)) ?: [];

        return array_values(array_filter(array_map('trim', $blocks), fn (string $e) => $e !== ''));
    }

    /** @param  list<string>  $entries */
    private static function newest(array $entries, int $limit): string
    {
        $kept = [];
        $length = 0;

        foreach (array_reverse($entries) as $entry) {
            $add = mb_strlen($entry) + ($kept === [] ? 0 : strlen(self::SEPARATOR));
            if ($length + $add > $limit) {
                break;
            }
            array_unshift($kept, $entry);
            $length += $add;
        }

        // A single entry larger than the limit (a long hand-written note) is cut, not dropped.
        if ($kept === [] && $entries !== []) {
            return mb_substr($entries[count($entries) - 1], 0, $limit);
        }

        return implode(self::SEPARATOR, $kept);
    }
}
