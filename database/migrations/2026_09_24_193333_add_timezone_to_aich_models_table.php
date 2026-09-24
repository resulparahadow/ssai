<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The creator's IANA timezone (e.g. "America/New_York"). The engine reads its "current
 * time" and the per-message stamps on this clock, so a US creator's lunchtime isn't
 * described to the AI as the UTC evening the server lives in.
 *
 * Nullable: a creator without one falls back to `services.engine.default_timezone`
 * (see AichModel::timezoneOrDefault()).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('aich_models', function (Blueprint $table) {
            $table->string('timezone', 64)->nullable()->after('of_account_id');
        });
    }

    public function down(): void
    {
        Schema::table('aich_models', function (Blueprint $table) {
            $table->dropColumn('timezone');
        });
    }
};
