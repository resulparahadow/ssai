<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Folds the legacy `chatters` RBAC into Laravel's `users` table.
 * Roles expand from the legacy manager|chatter to admin|manager|chatter
 * (the new design adds an admin/owner tier above manager).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->enum('role', ['admin', 'manager', 'chatter'])->default('chatter')->after('email');
            $table->boolean('must_change_password')->default(false)->after('role');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['role', 'must_change_password']);
        });
    }
};
