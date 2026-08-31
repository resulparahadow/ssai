<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Prune the on-disk cache of decrypted DRM videos.
 *
 * Those files are kept so a re-watch doesn't re-run the (billed, 8-15s) DRM download, but
 * nothing else ever deletes them — a busy account would fill the disk with full-length videos.
 */
class PruneDrmCache extends Command
{
    protected $signature = 'of:prune-drm-cache {--days=7 : Delete cached videos untouched for this many days}';

    protected $description = 'Delete decrypted OnlyFans DRM videos cached longer than the retention window';

    public function handle(): int
    {
        $days = max(1, (int) $this->option('days'));
        $cutoff = now()->subDays($days)->getTimestamp();
        $disk = Storage::disk('local');

        $deleted = 0;
        $freed = 0;

        foreach ($disk->allFiles('of-drm') as $file) {
            if ($disk->lastModified($file) > $cutoff) {
                continue;
            }

            $freed += $disk->size($file);
            $disk->delete($file);
            $deleted++;
        }

        $this->info("Pruned {$deleted} cached DRM video(s), freed ".round($freed / 1048576, 1).' MB.');

        return self::SUCCESS;
    }
}
