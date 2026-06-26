<?php

namespace Database\Seeders;

use App\Models\Doctrine;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Process;

/**
 * Imports the EXACT legacy DEFAULT_TRAINING doctrine (132 KB) from
 * legacy/js/doctrine.js into the doctrines table so the integrity layer and the
 * eventual PHP port share the same canonical brain the Node engine runs.
 *
 * The doctrine is a JS template literal, so we evaluate it with Node (the same
 * trick legacy/CLAUDE.md documents) rather than reading raw file bytes — the
 * SHA-256 is of the runtime string, not the file (which still has JS escapes).
 */
class DoctrineSeeder extends Seeder
{
    public function run(): void
    {
        $script = <<<'JS'
        const fs = require('fs');
        const src = fs.readFileSync('legacy/js/doctrine.js', 'utf8');
        const { DEFAULT_TRAINING, DEFAULT_TRAINING_SHA256 } =
            new Function(src + '\nreturn { DEFAULT_TRAINING, DEFAULT_TRAINING_SHA256 };')();
        process.stdout.write(JSON.stringify({ prompt: DEFAULT_TRAINING, sha: DEFAULT_TRAINING_SHA256 }));
        JS;

        $result = Process::path(base_path())->run(['node', '-e', $script]);

        if (! $result->successful()) {
            $this->command?->warn('DoctrineSeeder skipped — could not eval legacy doctrine via node: '.trim($result->errorOutput()));

            return;
        }

        $data = json_decode($result->output(), true);
        $prompt = $data['prompt'] ?? '';
        $declaredSha = $data['sha'] ?? '';
        $computedSha = hash('sha256', $prompt);

        if ($prompt === '' || $computedSha !== $declaredSha) {
            $this->command?->warn("DoctrineSeeder skipped — integrity mismatch (declared {$declaredSha}, computed {$computedSha}).");

            return;
        }

        // Parse the version from the header line: "SMARTSTARSAI — GLOBAL AGENCY TRAINING (v0.4.5.1)".
        preg_match('/\(v([0-9.]+)\)/', $prompt, $m);
        $version = 'v'.($m[1] ?? '0.0.0');

        Doctrine::query()->update(['is_active' => false]);

        Doctrine::updateOrCreate(
            ['version' => $version],
            ['prompt' => $prompt, 'sha256' => $computedSha, 'tier' => 'system', 'is_active' => true,
                'notes' => 'Imported verbatim from legacy/js/doctrine.js (the Node engine runs this exact text).'],
        );

        $this->command?->info("Seeded doctrine {$version} (".strlen($prompt).' chars, sha '.substr($computedSha, 0, 12).'…).');
    }
}
