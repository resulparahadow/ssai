<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI drafts a chatter rejected, with their reason — legacy's "Feedback → Submit & Reject".
 * Every later generate for the same conversation sends these to the AI as legacy's
 * "REJECTED RESPONSES IN THIS SESSION — learn from these mistakes" block, so it stops
 * repeating a mistake the chatter already corrected.
 *
 * A scoped exception to "Conversations persists no message text": `draft` is the AI's own
 * rejected output and `feedback` the chatter's reason — never a fan message. Stored (legacy
 * kept them in memory only) so they survive reloads and are shared by every chatter on the
 * fan. Rows are kept as history; which ones still steer the AI is decided at generate time
 * (DraftRejectionService::active — current conversation only).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_draft_rejections', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');                                        // CreatorAccessScope + scoping
            $table->string('chat_id');                                              // opaque OF chat/fan id
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete(); // who rejected
            $table->text('draft');                                                  // the rejected AI draft
            $table->text('feedback');                                               // the chatter's reason
            $table->timestamps();                                                   // created_at drives the active window

            $table->index(['creator_model', 'chat_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_draft_rejections');
    }
};
