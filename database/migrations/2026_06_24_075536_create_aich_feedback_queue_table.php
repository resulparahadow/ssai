<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Manager-reviewed corrections. On approval the legacy app APPENDS proposed_rules
 * to the creator model's feedback_rules (does not replace). source_message_ids
 * links the correction back to the messages that prompted it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_feedback_queue', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');
            $table->json('proposed_rules')->nullable();
            $table->json('source_message_ids')->nullable();
            $table->string('status')->default('pending'); // pending | approved | rejected
            $table->integer('rejection_count')->default(0);
            $table->timestamp('resolved_at')->nullable();
            $table->string('resolved_by')->nullable();
            $table->timestamps();

            $table->index(['creator_model', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_feedback_queue');
    }
};
