<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dual-purpose message store (faithful to the legacy table):
 *  - draft-log rows: response_text / input_messages / was_sent / feedback_text
 *  - per-message rows (OnlyFans path): sender / text / of_message_id / send_state
 * of_message_id is the dedup key that stops the pull / received / sent-echo
 * triple-insert. NULLs are distinct, so draft-log rows (null of_message_id) coexist.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('session_id')->nullable()->constrained('aich_sessions')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); // chatter
            $table->string('creator_model')->nullable();
            $table->string('customer_username')->nullable();
            $table->string('sender')->nullable();            // customer | creator
            $table->text('text')->nullable();                // per-message body (OF path)
            $table->longText('response_text')->nullable();   // draft-log body
            $table->json('input_messages')->nullable();
            $table->boolean('was_sent')->default(false);
            $table->text('feedback_text')->nullable();
            $table->text('agent_note')->nullable();
            $table->string('api_used')->nullable();          // claude | mistral
            $table->string('of_message_id')->nullable()->unique(); // OF dedup key
            $table->string('send_state')->nullable();
            $table->timestamps();

            $table->index(['session_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_messages');
    }
};
