<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Analytics event log. event_type values include agent_override, tip_recorded,
 * sexting_mode_toggled, tip_mode_toggled, spend_override (see legacy CLAUDE.md).
 * `user_id` is the chatter (auto-injected). `payload` carries the per-event JSON.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); // chatter
            $table->string('event_type');
            $table->string('creator_model')->nullable();
            $table->foreignId('session_id')->nullable()->constrained('aich_sessions')->nullOnDelete();
            $table->string('customer_username')->nullable();
            $table->json('payload')->nullable();
            $table->timestamps();

            $table->index(['event_type', 'created_at']);
            $table->index('creator_model');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_events');
    }
};
