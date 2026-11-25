<?php

namespace App\Services\Scripts;

/**
 * Parses CreatorHero's Scripts → Export CSV (`Name, Category, Script Order, Message, Fallback,
 * Price, Created At`) into scripts + steps. Pure: no database, no storage. The export has no
 * media column, so a step that was a PPV / free-media step comes in flagged `needsMedia`.
 */
class CreatorHeroScriptImport
{
    public const MAX_TITLE = 120;

    public const MAX_NAME = 120;

    public const MAX_TEXT = 2000;

    public const MAX_FALLBACK = 60;

    private const NEEDS_MEDIA_TITLE = '/\((?:\s*PPV|\s*FREE)\s*\)|FREE PIC/i';

    /**
     * @return array{scripts: list<array{name: string, steps: list<array{title: string, text: string|null, fallbackName: string|null, price: float, needsMedia: bool, order: int}>}>, warnings: list<string>}
     *
     * @throws \InvalidArgumentException when the header lacks the Name/Category columns
     */
    public function parse(string $csv): array
    {
        $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv) ?? $csv;

        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $csv);
        rewind($stream);

        $header = fgetcsv($stream, escape: '');
        $cols = [];
        foreach ($header ?: [] as $i => $h) {
            $cols[strtolower(trim((string) $h))] = $i;
        }
        foreach (['name', 'category'] as $required) {
            if (! isset($cols[$required])) {
                fclose($stream);
                throw new \InvalidArgumentException('This does not look like a CreatorHero scripts export (missing "'.ucfirst($required).'" column).');
            }
        }
        $cell = fn (array $row, string $col): string => isset($cols[$col], $row[$cols[$col]]) ? (string) $row[$cols[$col]] : '';

        $warnings = [];
        $groups = []; // category => list<{seq, order, step}>
        $seq = 0;
        while (($row = fgetcsv($stream, escape: '')) !== false) {
            if ($row === [null]) {
                continue; // blank line
            }
            $title = trim($cell($row, 'name'));
            $category = trim($cell($row, 'category'));
            if ($title === '' || $category === '') {
                $warnings[] = 'Skipped a row with no name or category.';

                continue;
            }

            if (mb_strlen($category) > self::MAX_NAME) {
                $category = mb_substr($category, 0, self::MAX_NAME);
                $warnings[] = "\"{$title}\": category was longer than ".self::MAX_NAME.' characters and was cut.';
            }

            $text = trim($cell($row, 'message'));
            $fallback = trim($cell($row, 'fallback'));
            $priceCell = trim($cell($row, 'price'));
            $badPrice = $priceCell !== '' && ! is_numeric($priceCell);
            $rawPrice = $badPrice ? 0.0 : (float) $priceCell;

            foreach ([['title', &$title, self::MAX_TITLE], ['message', &$text, self::MAX_TEXT], ['fallback', &$fallback, self::MAX_FALLBACK]] as [$label, &$value, $max]) {
                if (mb_strlen($value) > $max) {
                    $value = mb_substr($value, 0, $max);
                    $warnings[] = "\"{$title}\": {$label} was longer than {$max} characters and was cut.";
                }
            }
            unset($value);

            $price = $rawPrice;
            if ($price != 0.0 && ($price < 3 || $price > 200)) {
                $warnings[] = "\"{$title}\": price \${$rawPrice} is not free or \$3–\$200, so it was imported as free.";
                $price = 0.0;
            }

            if ($badPrice) {
                $warnings[] = "\"{$title}\": price \"{$priceCell}\" is not a number, so it was imported as free and needs media.";
            }

            $needsMedia = $badPrice || $rawPrice > 0 || preg_match(self::NEEDS_MEDIA_TITLE, $title) === 1;

            if ($text === '' && ! $needsMedia) {
                $warnings[] = "\"{$title}\": no message and no media, so it was skipped.";

                continue;
            }

            $groups[$category][] = [
                'seq' => $seq++,
                'order' => (int) trim($cell($row, 'script order')),
                'step' => [
                    'title' => $title,
                    'text' => $text === '' ? null : $text,
                    'fallbackName' => $fallback === '' ? null : $fallback,
                    'price' => $price,
                    'needsMedia' => $needsMedia,
                ],
            ];
        }
        fclose($stream);

        $scripts = [];
        foreach ($groups as $name => $rows) {
            usort($rows, fn ($a, $b) => [$a['order'], $a['seq']] <=> [$b['order'], $b['seq']]);
            $steps = [];
            foreach ($rows as $i => $r) {
                $steps[] = $r['step'] + ['order' => $i];
            }
            $scripts[] = ['name' => (string) $name, 'steps' => $steps];
        }

        return ['scripts' => $scripts, 'warnings' => $warnings];
    }
}
