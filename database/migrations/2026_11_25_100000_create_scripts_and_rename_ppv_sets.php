<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Scripts: an ordered, named list of steps per creator. The old creator-wide PPV sets become
 * script steps (ids and order kept) and every creator's existing sets land in one script
 * called "PPV sets". The send ledger follows: it now points at a step (nullOnDelete, so
 * deleting a script or step keeps history) and snapshots the step title.
 * See docs/superpowers/specs/2026-11-25-scripts-design.md.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scripts', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');                                           // aich_models.name — CreatorAccessScope
            $table->string('name', 120);
            $table->unsignedInteger('sort_order')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['creator_model', 'sort_order']);
        });

        // Ledger first, while the tables still carry their original names (fk names are
        // derived from them).
        Schema::table('ppv_set_sends', function (Blueprint $table) {
            $table->dropForeign(['ppv_set_id']);
        });
        Schema::table('ppv_set_sends', function (Blueprint $table) {
            $table->renameColumn('ppv_set_id', 'script_step_id');
        });

        Schema::rename('ppv_sets', 'script_steps');
        Schema::rename('ppv_set_sends', 'script_step_sends');

        Schema::table('script_steps', function (Blueprint $table) {
            $table->renameColumn('name', 'title');
            $table->renameColumn('caption', 'text');
        });
        Schema::table('script_steps', function (Blueprint $table) {
            $table->string('fallback_name', 60)->nullable()->after('text');
            $table->unsignedBigInteger('script_id')->nullable()->after('id');
        });

        // One "PPV sets" script per creator that already has sets.
        foreach (DB::table('script_steps')->distinct()->pluck('creator_model') as $creator) {
            $scriptId = DB::table('scripts')->insertGetId([
                'creator_model' => $creator,
                'name' => 'PPV sets',
                'sort_order' => 0,
                'created_by' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('script_steps')->where('creator_model', $creator)->update(['script_id' => $scriptId]);
        }

        Schema::table('script_steps', function (Blueprint $table) {
            $table->unsignedBigInteger('script_id')->nullable(false)->change();
            $table->foreign('script_id')->references('id')->on('scripts')->cascadeOnDelete();
        });

        Schema::table('script_step_sends', function (Blueprint $table) {
            $table->unsignedBigInteger('script_step_id')->nullable()->change();
            $table->string('of_message_id')->nullable()->change();
            $table->decimal('price', 6, 2)->nullable()->change();
            $table->string('step_title', 120)->default('')->after('script_step_id');
            $table->enum('source', ['send', 'manual'])->default('send')->after('price');
        });
        Schema::table('script_step_sends', function (Blueprint $table) {
            $table->foreign('script_step_id')->references('id')->on('script_steps')->nullOnDelete();
        });

        foreach (DB::table('script_steps')->get(['id', 'title']) as $step) {
            DB::table('script_step_sends')->where('script_step_id', $step->id)->update(['step_title' => $step->title]);
        }
    }

    public function down(): void
    {
        Schema::table('script_step_sends', function (Blueprint $table) {
            $table->dropForeign(['script_step_id']);
        });
        // Ledger rows whose step is gone (or manual marks) have no ppv_set to point at.
        DB::table('script_step_sends')->where('source', 'manual')->orWhereNull('script_step_id')->delete();
        DB::table('script_step_sends')->whereNull('price')->update(['price' => 0]);

        Schema::table('script_step_sends', function (Blueprint $table) {
            $table->dropColumn(['step_title', 'source']);
        });
        Schema::table('script_step_sends', function (Blueprint $table) {
            $table->unsignedBigInteger('script_step_id')->nullable(false)->change();
            $table->decimal('price', 6, 2)->nullable(false)->change();
        });

        Schema::table('script_steps', function (Blueprint $table) {
            $table->dropForeign(['script_id']);
        });
        // Steps without media cannot exist as PPV sets.
        DB::table('script_steps')->where('media', '[]')->delete();
        Schema::table('script_steps', function (Blueprint $table) {
            $table->dropColumn(['script_id', 'fallback_name']);
        });
        Schema::table('script_steps', function (Blueprint $table) {
            $table->renameColumn('title', 'name');
            $table->renameColumn('text', 'caption');
        });

        Schema::rename('script_steps', 'ppv_sets');
        Schema::rename('script_step_sends', 'ppv_set_sends');

        Schema::table('ppv_set_sends', function (Blueprint $table) {
            $table->renameColumn('script_step_id', 'ppv_set_id');
        });
        Schema::table('ppv_set_sends', function (Blueprint $table) {
            $table->foreign('ppv_set_id')->references('id')->on('ppv_sets')->cascadeOnDelete();
        });

        Schema::dropIfExists('scripts');
    }
};
