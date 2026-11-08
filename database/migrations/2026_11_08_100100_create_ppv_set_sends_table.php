<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ledger of PPV sets sent from SSAI: which set went to which fan, as which OnlyFans message,
 * at what price, by which chatter. It is what the PPV rail's per-fan "Sent / Bought" pill
 * reads (bought = the ledger's message id appears in the thread with `isOpened`), and it
 * is the only record there is — sets sent from CreatorHero or OnlyFans directly are
 * invisible, because chat-message media ids cannot be mapped back to vault ids.
 *
 * Metadata only: ids, a price and a time. No message text.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ppv_set_sends', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ppv_set_id')->constrained('ppv_sets')->cascadeOnDelete();
            $table->string('creator_model');                                           // CreatorAccessScope (via BelongsToChatter)
            $table->string('of_fan_id');                                               // = the chat id
            $table->string('of_message_id')->nullable();                               // vendor message id from the send response
            $table->decimal('price', 6, 2);                                            // price actually sent
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete(); // who sent it (auto-stamped)
            $table->timestamp('sent_at');
            $table->timestamps();

            $table->index(['creator_model', 'of_fan_id', 'ppv_set_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ppv_set_sends');
    }
};
