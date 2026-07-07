<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-conversation state. `user_id` is the chatter (auto-injected on create
 * in the legacy app via installChatterIdAutoInject(); reproduced here with a
 * BelongsToChatter model hook). The in-memory `_`-prefixed JS telemetry fields
 * are NOT persisted — only the snake_case columns below are.
 * The OnlyFans (creator_model, of_chat_id) unique index reproduces the legacy
 * TOCTOU guard against duplicate sessions under concurrent webhook delivery.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); // chatter
            $table->string('creator_model');
            $table->string('customer_name')->nullable();
            $table->string('customer_username')->nullable();
            $table->string('status')->default('active');
            $table->string('current_posture')->nullable();   // WARM_BUILD|PROBE|PRESSURE|TIMEWASTER
            $table->json('ladder_state')->nullable();
            $table->integer('story_framework_step')->default(0);
            $table->string('promise_status')->nullable();
            $table->integer('free_msg_count')->default(0);
            $table->integer('unpaid_cta_count')->default(0);
            $table->decimal('total_spend', 10, 2)->default(0);
            $table->decimal('tips_spend', 10, 2)->default(0);
            $table->boolean('is_flagged')->default(false);
            $table->text('crm_notes')->nullable();
            $table->longText('draft')->nullable();
            $table->json('messages')->nullable();        // rendered conversation log
            $table->json('messages_input')->nullable();  // raw input buffer
            $table->json('vn_used')->nullable();
            $table->text('aftercare_context')->nullable();
            $table->string('input_mode')->nullable();
            $table->string('of_chat_id')->nullable();    // OnlyFans chat link
            $table->timestamp('last_active_at')->nullable();
            $table->timestamp('session_closed_at')->nullable();
            $table->integer('session_closed_at_msg_count')->nullable();
            $table->timestamps();

            // NULL of_chat_id values are distinct in MySQL, so manual (non-OF)
            // sessions coexist while OF-linked sessions stay unique per creator.
            $table->unique(['creator_model', 'of_chat_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_sessions');
    }
};
