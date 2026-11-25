<?php

use App\Models\ModelAssignment;
use App\Models\Script;
use App\Models\ScriptStep;
use App\Models\ScriptStepSend;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

function scriptChatter(string $creator): User
{
    $user = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $user->id, 'creator_model' => $creator]);

    return $user;
}

function scriptWithStep(string $creator, string $title = 'Red set', array $media = [['id' => '1', 'type' => 'photo', 'thumb' => null]], float $price = 20): ScriptStep
{
    $script = Script::create(['creator_model' => $creator, 'name' => 'Script '.$title]);

    return ScriptStep::create([
        'script_id' => $script->id,
        'creator_model' => $creator,
        'title' => $title,
        'price' => $price,
        'media' => $media,
    ]);
}

it('migrates every creator\'s sets into one "PPV sets" script, keeping ids and order', function () {
    Artisan::call('migrate:rollback', [
        '--path' => 'database/migrations/2026_11_25_100000_create_scripts_and_rename_ppv_sets.php',
    ]);

    $row = fn (string $creator, string $name, int $sort, int $id) => [
        'id' => $id, 'creator_model' => $creator, 'name' => $name, 'caption' => "cap {$name}",
        'price' => 20, 'media' => json_encode([['id' => 'v', 'type' => 'photo', 'thumb' => null]]),
        'sort_order' => $sort, 'created_at' => now(), 'updated_at' => now(),
    ];
    DB::table('ppv_sets')->insert([
        $row('Camila', 'A', 0, 11), $row('Camila', 'B', 1, 12),
        $row('Nina', 'C', 0, 13), $row('Nina', 'D', 5, 14),
    ]);
    DB::table('ppv_set_sends')->insert([
        'ppv_set_id' => 12, 'creator_model' => 'Camila', 'of_fan_id' => '101',
        'price' => 20, 'sent_at' => now(), 'created_at' => now(), 'updated_at' => now(),
    ]);

    Artisan::call('migrate');

    expect(DB::table('scripts')->where('name', 'PPV sets')->count())->toBe(2)
        ->and(DB::table('scripts')->count())->toBe(2);

    $steps = DB::table('script_steps')->orderBy('id')->get();
    expect($steps->pluck('id')->all())->toBe([11, 12, 13, 14])
        ->and($steps->pluck('sort_order')->all())->toBe([0, 1, 0, 5])
        ->and($steps->pluck('title')->all())->toBe(['A', 'B', 'C', 'D'])
        ->and($steps->pluck('text')->all())->toBe(['cap A', 'cap B', 'cap C', 'cap D']);

    // Each creator's steps share one script of that creator.
    foreach (['Camila', 'Nina'] as $creator) {
        $ids = $steps->where('creator_model', $creator)->pluck('script_id')->unique();
        expect($ids)->toHaveCount(1)
            ->and(DB::table('scripts')->find($ids->first())->creator_model)->toBe($creator);
    }

    $send = DB::table('script_step_sends')->sole();
    expect((int) $send->script_step_id)->toBe(12)
        ->and($send->step_title)->toBe('B')
        ->and($send->source)->toBe('send');
});

it('derives kind from media and price', function () {
    expect(scriptWithStep('Camila', 'T', [], 0)->kind)->toBe('text')
        ->and(scriptWithStep('Camila', 'F', [['id' => '1', 'type' => 'photo', 'thumb' => null]], 0)->kind)->toBe('free')
        ->and(scriptWithStep('Camila', 'P', [['id' => '1', 'type' => 'photo', 'thumb' => null]], 12)->kind)->toBe('ppv');
});

it('casts media to an array and price to a 2-decimal string', function () {
    $step = scriptWithStep('Camila')->fresh();

    expect($step->media)->toBe([['id' => '1', 'type' => 'photo', 'thumb' => null]])
        ->and($step->price)->toBe('20.00');
});

it('keeps sends when a step is deleted', function () {
    $step = scriptWithStep('Camila');
    $this->actingAs(scriptChatter('Camila'));

    $row = ScriptStepSend::create([
        'script_step_id' => $step->id,
        'step_title' => $step->title,
        'creator_model' => 'Camila',
        'of_fan_id' => '101',
        'price' => 20,
        'sent_at' => now(),
    ]);

    expect($row->user_id)->toBe(auth()->id())
        ->and($step->sends()->count())->toBe(1);

    $step->delete();

    $kept = ScriptStepSend::withoutGlobalScopes()->sole();
    expect($kept->script_step_id)->toBeNull()
        ->and($kept->step_title)->toBe('Red set');
});

it('scopes scripts and steps to assigned creators for chatters', function () {
    scriptWithStep('Camila', 'Red set');
    scriptWithStep('Nina', 'Nina set');

    $this->actingAs(scriptChatter('Camila'));

    expect(ScriptStep::pluck('title')->all())->toBe(['Red set'])
        ->and(Script::pluck('creator_model')->all())->toBe(['Camila']);
});

it('orders a script\'s steps by sort_order then id', function () {
    $script = Script::create(['creator_model' => 'Camila', 'name' => 'S']);
    foreach ([[2, 'b'], [1, 'a'], [2, 'c']] as [$sort, $t]) {
        ScriptStep::create(['script_id' => $script->id, 'creator_model' => 'Camila', 'title' => $t, 'text' => 'x', 'media' => [], 'sort_order' => $sort]);
    }

    expect($script->steps->pluck('title')->all())->toBe(['a', 'b', 'c']);
});
