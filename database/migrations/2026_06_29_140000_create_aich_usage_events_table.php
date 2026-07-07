<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-LLM-call AI usage metering (restores the legacy js/api.js _ssaiCostLog telemetry).
 * One row per engine call (strategy / generator / retries), grouped by generation_id.
 * METADATA ONLY — no message text is ever stored here, just token counts + cost.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_usage_events', function (Blueprint $table) {
            $table->id();
            $table->ulid('generation_id');                                   // groups the calls of one generate()
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); // chatter who triggered it
            $table->string('creator_model')->nullable();
            $table->string('chat_id')->nullable();                           // opaque OF chat/fan id (live path)
            $table->foreignId('session_id')->nullable()->constrained('aich_sessions')->nullOnDelete(); // dev path
            $table->string('source')->default('live');                       // live | session
            $table->string('call_type')->nullable();                         // strategy_sonnet | generator | generator_mistral | …
            $table->string('model')->nullable();
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('cache_read_tokens')->default(0);
            $table->unsignedInteger('cache_create_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->decimal('cost', 12, 6)->default(0);
            $table->boolean('cached')->default(false);
            $table->unsignedInteger('duration_ms')->nullable();
            $table->decimal('tok_per_sec', 8, 1)->nullable();
            $table->json('sys_blocks')->nullable();                          // for the cost-diagnostic breakdown
            $table->timestamp('created_at')->nullable();

            $table->index(['creator_model', 'created_at']);
            $table->index(['user_id', 'created_at']);
            $table->index('generation_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_usage_events');
    }
};
