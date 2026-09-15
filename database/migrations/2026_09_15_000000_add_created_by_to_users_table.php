<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Provenance for team management: which user created this account.
 *
 * Nullable because accounts that predate this column — the seeded first admin
 * above all — have no creator. `nullOnDelete` is the load-bearing half: removing
 * a manager must neither cascade-delete the chatters they hired nor block the
 * delete; those rows simply lose their "added by" label.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('created_by')
                ->nullable()
                ->after('must_change_password')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by');
        });
    }
};
