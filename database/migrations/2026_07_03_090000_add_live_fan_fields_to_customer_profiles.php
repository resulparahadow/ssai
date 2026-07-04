<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Live-path fan memory: connect customer_profiles to an OnlyFans fan (of_fan_id =
 * the chat id) and add the per-field lock + per-fan behavior toggles the AI
 * generate flow reads/writes. See docs/superpowers/specs/2026-07-03-fan-customer-profile-design.md.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_profiles', function (Blueprint $table) {
            $table->string('of_fan_id')->nullable()->after('customer_username');
            $table->json('locked_fields')->nullable()->after('crm_notes');
            $table->string('sexting_mode')->default('AUTO')->after('locked_fields');
            $table->string('tip_mode')->default('AUTO')->after('sexting_mode');

            // key_details becomes the AI's free-text memory log (was a json array).
            $table->text('key_details')->nullable()->change();

            $table->unique(['creator_model', 'of_fan_id']);
        });
    }

    public function down(): void
    {
        Schema::table('customer_profiles', function (Blueprint $table) {
            $table->dropUnique(['creator_model', 'of_fan_id']);
            $table->dropColumn(['of_fan_id', 'locked_fields', 'sexting_mode', 'tip_mode']);
        });
    }
};
