<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\Script;
use App\Models\ScriptStep;
use App\Models\User;
use App\Services\Scripts\CreatorHeroScriptImport;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;

uses(RefreshDatabase::class);

/** Neutral placeholder text in the shape of CreatorHero's export (BOM, CRLF, quoted multi-line message). */
function heroCsv(): string
{
    return "\xEF\xBB\xBF".implode("\r\n", [
        'Name,Category,Script Order,Message,Fallback,Price,Created At',
        'MS 1.2,"Master Script ",11,"Line one'."\r\n".'Line two, with comma",Babe,0.0,2026-03-31 15:00:17.879736',
        'MS 1.7 (PPV),Master Script,12,Open this one,,12.0,2026-03-31 15:00:17.879736',
        'MS 1.4 (FREE),Master Script,10,Free pic for you,,0.0,2026-03-31 15:00:17.879736',
        'Odd price,Side Script,2,Second,,2.5,2026-03-31 15:00:17.879736',
        ' Plain , Side Script ,1,First,,0.0,2026-03-31 15:00:17.879736',
    ]);
}

function heroFile(?string $csv = null, string $name = 'Scripts.csv'): UploadedFile
{
    return UploadedFile::fake()->createWithContent($name, $csv ?? heroCsv());
}

beforeEach(function () {
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'p', 'of_account_id' => 'acct_cam']);
    $this->nina = AichModel::create(['name' => 'Nina', 'prompt' => 'p', 'of_account_id' => 'acct_nina']);
    $this->manager = User::factory()->manager()->create();
    $this->url = "/onlyfans/{$this->model->id}/scripts/import";
});

it('parses grouping, order, trimmed names, needs-media and the off-rule price', function () {
    $r = (new CreatorHeroScriptImport)->parse(heroCsv());

    expect(array_column($r['scripts'], 'name'))->toBe(['Master Script', 'Side Script']);

    $master = $r['scripts'][0]['steps'];
    expect(array_column($master, 'title'))->toBe(['MS 1.4 (FREE)', 'MS 1.2', 'MS 1.7 (PPV)'])
        ->and(array_column($master, 'order'))->toBe([0, 1, 2])
        ->and($master[0]['needsMedia'])->toBeTrue()
        ->and($master[0]['price'])->toBe(0.0)
        ->and($master[1]['needsMedia'])->toBeFalse()
        ->and($master[1]['text'])->toBe("Line one\r\nLine two, with comma")
        ->and($master[1]['fallbackName'])->toBe('Babe')
        ->and($master[2]['needsMedia'])->toBeTrue()
        ->and($master[2]['price'])->toBe(12.0);

    $side = $r['scripts'][1]['steps'];
    expect(array_column($side, 'title'))->toBe(['Plain', 'Odd price'])
        ->and($side[1]['price'])->toBe(0.0)
        ->and($r['warnings'])->toHaveCount(1)
        ->and($r['warnings'][0])->toContain('Odd price');
});

it('truncates over-long fields and reports it', function () {
    $csv = "Name,Category,Script Order,Message,Fallback,Price,Created At\n".
        str_repeat('T', 130).',Cat,1,'.str_repeat('x', 2100).','.str_repeat('f', 70).",0,2026-01-01\n";
    $r = (new CreatorHeroScriptImport)->parse($csv);
    $s = $r['scripts'][0]['steps'][0];

    expect(mb_strlen($s['title']))->toBe(120)
        ->and(mb_strlen($s['text']))->toBe(2000)
        ->and(mb_strlen($s['fallbackName']))->toBe(60)
        ->and($r['warnings'])->toHaveCount(3);
});

it('caps a long category at 120 characters, warns, and groups on the capped name', function () {
    $head = str_repeat('C', 120);
    $csv = "Name,Category,Script Order,Message,Fallback,Price,Created At\n".
        'A,'.$head.'1,1,one,,0,2026-01-01'."\n".
        'B,'.$head.'2,2,two,,0,2026-01-01'."\n";
    $r = (new CreatorHeroScriptImport)->parse($csv);

    expect($r['scripts'])->toHaveCount(1)
        ->and(mb_strlen($r['scripts'][0]['name']))->toBe(120)
        ->and($r['scripts'][0]['steps'])->toHaveCount(2)
        ->and($r['warnings'])->not->toBeEmpty()
        ->and($r['warnings'][0])->toContain('category');
});

it('flags a non-numeric price as needs-media with a warning, and leaves an empty price alone', function () {
    $csv = "Name,Category,Script Order,Message,Fallback,Price,Created At\n".
        'Dollar,Cat,1,hello,,$12,2026-01-01'."\n".
        'Empty,Cat,2,hello,,,2026-01-01'."\n";
    $r = (new CreatorHeroScriptImport)->parse($csv);
    $steps = $r['scripts'][0]['steps'];

    expect($steps[0]['needsMedia'])->toBeTrue()
        ->and($steps[0]['price'])->toBe(0.0)
        ->and($steps[1]['needsMedia'])->toBeFalse()
        ->and($steps[1]['price'])->toBe(0.0)
        ->and($r['warnings'])->toHaveCount(1)
        ->and($r['warnings'][0])->toContain('Dollar');
});

it('previews without writing anything', function () {
    $this->actingAs($this->manager)
        ->post($this->url, ['file' => heroFile()], ['Accept' => 'application/json'])
        ->assertOk()
        ->assertJsonPath('totals', ['scripts' => 2, 'steps' => 5, 'needsMedia' => 3, 'skipped' => 0])
        ->assertJsonPath('scripts.0', ['name' => 'Master Script', 'steps' => 3, 'needsMedia' => 2, 'skipped' => false])
        ->assertJsonCount(1, 'warnings')
        ->assertJsonMissingPath('created');

    expect(Script::withoutGlobalScopes()->count())->toBe(0)
        ->and(ScriptStep::withoutGlobalScopes()->count())->toBe(0);
});

it('commits scripts and steps with needs_media, then skips the same file the second time', function () {
    $this->actingAs($this->manager)
        ->post($this->url, ['file' => heroFile(), 'commit' => 1], ['Accept' => 'application/json'])
        ->assertOk()
        ->assertJsonPath('created', 2);

    $master = Script::withoutGlobalScopes()->where('creator_model', 'Camila')->where('name', 'Master Script')->firstOrFail();
    $steps = ScriptStep::withoutGlobalScopes()->where('script_id', $master->id)->orderBy('sort_order')->get();
    expect($steps->pluck('title')->all())->toBe(['MS 1.4 (FREE)', 'MS 1.2', 'MS 1.7 (PPV)'])
        ->and($steps->pluck('needs_media')->all())->toBe([true, false, true])
        ->and($steps[2]->price)->toBe('12.00')
        ->and($steps[2]->media)->toBe([])
        ->and($steps[0]->creator_model)->toBe('Camila');

    $this->actingAs($this->manager)
        ->post($this->url, ['file' => heroFile(), 'commit' => 1], ['Accept' => 'application/json'])
        ->assertOk()
        ->assertJsonPath('created', 0)
        ->assertJsonPath('totals.skipped', 2)
        ->assertJsonPath('scripts.0.skipped', true);

    expect(Script::withoutGlobalScopes()->count())->toBe(2)
        ->and(ScriptStep::withoutGlobalScopes()->count())->toBe(5);
});

it('forbids chatters', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);

    $this->actingAs($chatter)->post($this->url, ['file' => heroFile()], ['Accept' => 'application/json'])->assertForbidden();
});

it('404s for a creator the manager cannot reach', function () {
    $this->actingAs($this->manager)
        ->post('/onlyfans/9999/scripts/import', ['file' => heroFile()], ['Accept' => 'application/json'])
        ->assertNotFound();
});

it('rejects an oversize or non-csv upload', function () {
    $this->actingAs($this->manager)
        ->post($this->url, ['file' => UploadedFile::fake()->create('big.csv', 2048, 'text/csv')], ['Accept' => 'application/json'])
        ->assertStatus(422);
    $this->actingAs($this->manager)
        ->post($this->url, ['file' => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
        ->assertStatus(422);
});

it('422s a csv without the expected columns', function () {
    $this->actingAs($this->manager)
        ->post($this->url, ['file' => heroFile("a,b\n1,2\n")], ['Accept' => 'application/json'])
        ->assertStatus(422);
});
