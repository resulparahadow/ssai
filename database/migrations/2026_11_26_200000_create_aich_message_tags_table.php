<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_message_tags', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');
            $table->string('chat_id', 64);
            $table->string('message_id', 64);
            $table->string('tag', 16);
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['creator_model', 'chat_id', 'message_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_message_tags');
    }
};
