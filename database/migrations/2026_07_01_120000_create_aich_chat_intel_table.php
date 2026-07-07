<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Latest AI Intel (the generate() strategy object) per live OnlyFans chat.
 * A deliberate, scoped exception to "Conversations persists nothing": stores
 * ONLY the analysis strategy (no message bodies, no media) so the right-rail
 * AI Intel panel survives a reload and is shared across chatters. One row per
 * (creator_model, chat_id) — upserted on each generate.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_chat_intel', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');                                          // enables CreatorAccessScope + scoping
            $table->string('chat_id');                                                // opaque OF chat/fan id
            $table->foreignId('generated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->json('strategy');                                                 // the AiStrategy object shown in AI Intel
            $table->timestamps();                                                     // updated_at = "generated at"

            $table->unique(['creator_model', 'chat_id']);                             // one latest row per chat, upsert target
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_chat_intel');
    }
};
