<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which creator models a chatter is allowed to work. Drives the row-level
 * scoping (a chatter only sees assigned creators); managers/admins see all.
 * `creator_model` is a string ref to aich_models.name (legacy convention).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('model_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete(); // the chatter
            $table->string('creator_model');
            $table->timestamps();

            $table->unique(['user_id', 'creator_model']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('model_assignments');
    }
};
