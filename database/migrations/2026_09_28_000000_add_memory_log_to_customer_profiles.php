<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * key_details becomes a log of dated entries, one per conversation (FanMemoryLog), instead of
 * a single summary the next generate overwrites. `key_details_written_at` records when the AI
 * last wrote its current entry, so the next generate knows whether that conversation is still
 * going (rewrite the entry) or a new one started (append). mediumText: the log is capped at
 * FanMemoryLog::MAX_CHARS characters, which can exceed TEXT's 65,535 bytes in multibyte text.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_profiles', function (Blueprint $table) {
            $table->mediumText('key_details')->nullable()->change();
            $table->timestamp('key_details_written_at')->nullable()->after('key_details');
        });
    }

    public function down(): void
    {
        Schema::table('customer_profiles', function (Blueprint $table) {
            $table->dropColumn('key_details_written_at');
            $table->text('key_details')->nullable()->change();
        });
    }
};
