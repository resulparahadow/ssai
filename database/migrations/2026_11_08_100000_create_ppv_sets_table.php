<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Creator-wide PPV sets: a saved bundle of Media Vault items + a price + a default caption
 * that chatters load into the composer from the Conversations PPV rail (the CreatorHero
 * "PPV tab" flow). Managers own the rows; chatters only read them.
 *
 * `media` is a JSON list of `{id, type, thumb}` — the OnlyFans VAULT id (what the send
 * endpoint's `mediaFiles` takes), its type, and an onlyfans.com-hosted thumbnail url or
 * null. onlyfans CDN thumbs load through the media proxy, which re-signs expired
 * signatures, so they stay valid; a cdn.fansapi.com presigned url expires in 15 minutes
 * and is never stored. No fan message text lives here.
 * See docs/superpowers/specs/2026-11-08-ppv-sets-design.md.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ppv_sets', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');                                           // aich_models.name — CreatorAccessScope
            $table->string('name', 120);
            $table->text('caption')->nullable();                                       // default text loaded into the typing bar
            $table->decimal('price', 6, 2)->default(0);                                // 0 (free) or 3.00–200.00 (vendor rule)
            $table->json('media');                                                     // ordered [{id, type, thumb}]
            $table->unsignedInteger('sort_order')->default(0);                         // manager ordering in the rail
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete(); // provenance only
            $table->timestamps();

            $table->index(['creator_model', 'sort_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ppv_sets');
    }
};
