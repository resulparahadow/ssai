<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Creator personas + content libraries (the per-model brain layer).
 * `name` is the isolation boundary used throughout the legacy code
 * (creator_model string refs point here). The legacy __global_training__
 * row that lived in this table has moved to the dedicated `doctrines` table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_models', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();            // creator model name (isolation boundary)
            $table->longText('prompt')->nullable();      // persona system prompt
            $table->json('content_library')->nullable(); // captions / media library
            $table->json('feedback_rules')->nullable();  // appended manager corrections
            $table->string('tier')->default('standard'); // 'system' reserved for global rows
            $table->string('of_account_id')->nullable(); // OnlyFans acct_XXXX link
            $table->timestamps();

            $table->index('of_account_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_models');
    }
};
