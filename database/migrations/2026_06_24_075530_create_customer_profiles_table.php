<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Long-term per-customer memory: trust, archetype, spend, key details.
 * Keyed by (creator_model, customer_username) — the same composite identity
 * the legacy app used for cross-session lookups.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_profiles', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');
            $table->string('customer_username');
            $table->string('customer_name')->nullable();
            $table->string('archetype')->nullable();
            $table->integer('trust_level')->default(0);
            $table->string('temperature')->nullable();
            $table->boolean('is_timewaster')->default(false);
            $table->timestamp('tw_auto_cleared_at')->nullable();
            $table->string('subscription_status')->nullable();
            $table->decimal('total_spend', 10, 2)->default(0); // PPV spend
            $table->decimal('tips_spend', 10, 2)->default(0);  // tip spend (effective-spend half)
            $table->integer('time_on_page')->nullable();
            $table->json('key_details')->nullable();
            $table->text('crm_notes')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();

            $table->unique(['creator_model', 'customer_username']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_profiles');
    }
};
