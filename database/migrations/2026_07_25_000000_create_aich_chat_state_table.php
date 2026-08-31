<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Carried AI strategy state per live OnlyFans chat — the "save file" that lets the
 * next generation build on prior turns (last strategy/analysis, planned next move,
 * promise + story-framework progress). Metadata only, no message text. One row per
 * (creator_model, chat_id), upserted when a generated draft is accepted/sent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_chat_state', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');                                          // enables CreatorAccessScope
            $table->string('chat_id');                                                // opaque OF chat/fan id
            $table->json('last_strategy')->nullable();                                // strategy that shaped the last committed message
            $table->json('last_analysis')->nullable();                                // folded analysis (_lastAnalysis shape)
            $table->string('next_planned_move')->nullable();                          // anti-drift forward plan
            $table->integer('next_planned_move_at_msg')->nullable();
            $table->string('promise_status')->default('not_started');
            $table->integer('story_framework_step')->default(0);
            $table->foreignId('committed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['creator_model', 'chat_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_chat_state');
    }
};
