<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * §5b state switches + the rest of §5c's counters. Metadata only — no message text.
 * See docs/superpowers/specs/2026-11-27-state-switches-design.md §6.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_profiles', function (Blueprint $table) {
            // Manual switch values, keyed by switch; an absent key = Auto.
            $table->json('state_overrides')->nullable();
            // When a message was sent under a manual RLS beat (auto-advance marker).
            $table->timestamp('rls_beat_sent_at')->nullable();
        });

        Schema::table('aich_chat_state', function (Blueprint $table) {
            $table->unsignedInteger('objection_redirects')->default(0);
            $table->unsignedInteger('sex_only_pulls')->default(0);
            // The fan message each counter last counted (counts once per fan message).
            $table->timestamp('objection_counted_at')->nullable();
            $table->timestamp('sex_only_counted_at')->nullable();
        });

        Schema::table('aich_chat_intel', function (Blueprint $table) {
            // The last generate's posture/tier/promise read, for the state card's "Auto · …" rows.
            $table->json('telemetry')->nullable();
        });

        Schema::table('aich_models', function (Blueprint $table) {
            $table->boolean('is_bilingual')->default(false);
            $table->json('price_ladder')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('customer_profiles', function (Blueprint $table) {
            $table->dropColumn(['state_overrides', 'rls_beat_sent_at']);
        });
        Schema::table('aich_chat_state', function (Blueprint $table) {
            $table->dropColumn(['objection_redirects', 'sex_only_pulls', 'objection_counted_at', 'sex_only_counted_at']);
        });
        Schema::table('aich_chat_intel', function (Blueprint $table) {
            $table->dropColumn('telemetry');
        });
        Schema::table('aich_models', function (Blueprint $table) {
            $table->dropColumn(['is_bilingual', 'price_ladder']);
        });
    }
};
