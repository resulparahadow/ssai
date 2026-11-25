<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('script_steps', function (Blueprint $table) {
            $table->boolean('needs_media')->default(false)->after('media');
        });
    }

    public function down(): void
    {
        Schema::table('script_steps', function (Blueprint $table) {
            $table->dropColumn('needs_media');
        });
    }
};
