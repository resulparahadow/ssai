<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The legacy content_library + feedback_rules are freeform text the manager edits
 * in the Models settings, not structured JSON. They were initially mirrored as
 * `json`; correct them to longText so the Models editor stores plain text.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('aich_models', function (Blueprint $table) {
            $table->longText('content_library')->nullable()->change();
            $table->longText('feedback_rules')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('aich_models', function (Blueprint $table) {
            $table->json('content_library')->nullable()->change();
            $table->json('feedback_rules')->nullable()->change();
        });
    }
};
