<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which provider a creator's `of_account_id` belongs to (`onlyfansapi` | `oopcrm`). OnlyFansAPI
 * and OopCRM list the same creator under different account ids, so the id only works on one
 * side; the app shows a creator only while its provider is the active one (Settings →
 * Integrations). Every id stored before OopCRM existed is an OnlyFansAPI id. The Creator Models
 * page corrects any row whose id it finds in the other provider's live account list.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('aich_models', function (Blueprint $table) {
            $table->string('provider', 20)->nullable()->after('of_account_id')->index();
        });

        DB::table('aich_models')->whereNotNull('of_account_id')->where('of_account_id', '!=', '')
            ->update(['provider' => 'onlyfansapi']);
    }

    public function down(): void
    {
        Schema::table('aich_models', function (Blueprint $table) {
            $table->dropIndex(['provider']);
            $table->dropColumn('provider');
        });
    }
};
