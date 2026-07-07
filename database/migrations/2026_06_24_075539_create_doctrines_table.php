<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The global agency training "brain" (legacy DEFAULT_TRAINING / __global_training__).
 *
 * Intentional improvement over the legacy schema: the doctrine used to live as a
 * single tier='system' row inside aich_models. Here it gets its own versioned,
 * integrity-checked table. The sha256 column reproduces the legacy three-layer
 * tamper check; exactly one row should be is_active = true at a time.
 *
 * The doctrine TEXT itself is authored work that lives outside this repo and is
 * NOT part of the Phase-1 port — this table is the storage shape only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('doctrines', function (Blueprint $table) {
            $table->id();
            $table->string('version');             // e.g. v0.4.5.1
            $table->longText('prompt');            // DEFAULT_TRAINING body
            $table->char('sha256', 64);            // integrity hash (hex)
            $table->string('tier')->default('system');
            $table->boolean('is_active')->default(false);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index('is_active');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doctrines');
    }
};
