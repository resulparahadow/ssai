<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Real-life creator status entries, fetched per-generation in the legacy app
 * by fetchActiveCreatorStatus() (active = not yet past expires_at).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('creator_status', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');
            $table->string('category')->nullable();
            $table->text('status_text');
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['creator_model', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('creator_status');
    }
};
