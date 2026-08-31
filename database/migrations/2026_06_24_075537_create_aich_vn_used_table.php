<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks which voice notes have already been sent to a given customer so the
 * generator never re-uses a labelled VN. Keyed by (creator_model,
 * customer_username, voice_note_label).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_vn_used', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');
            $table->string('customer_username');
            $table->foreignId('session_id')->nullable()->constrained('aich_sessions')->nullOnDelete();
            $table->string('voice_note_label');
            $table->timestamps();

            $table->unique(['creator_model', 'customer_username', 'voice_note_label'], 'uq_vn_used');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_vn_used');
    }
};
