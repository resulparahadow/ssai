<?php

use App\Models\AichMessage;
use App\Models\AichModel;
use App\Models\AichSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    AichModel::create([
        'name' => 'Camila',
        'prompt' => 'You are Camila, a warm playful creator.',
        'content_library' => 'Tier 1 ($15): teasing pics.',
    ]);

    $this->session = AichSession::withoutGlobalScopes()->create([
        'creator_model' => 'Camila',
        'customer_name' => 'Jake',
        'customer_username' => 'jake_demo',
        'total_spend' => 0,
        'tips_spend' => 0,
        'messages' => [
            ['sender' => 'customer', 'text' => 'hey camila how are you', 'ts_iso' => now()->subMinutes(5)->toIso8601String()],
            ['sender' => 'model', 'text' => 'heyy im good', 'ts_iso' => now()->subMinutes(4)->toIso8601String()],
            ['sender' => 'customer', 'text' => 'my day was long but better talking to you', 'ts_iso' => now()->toIso8601String()],
        ],
    ]);
});

it('runs the engine for a conversation and persists the draft', function () {
    Http::fake([
        '*/generate' => Http::response([
            'draft' => 'aw that means a lot babe, tell me what made it long 🙈',
            'strategy' => ['phase' => 'rapport', 'next_move' => 'qualify'],
            'telemetry' => ['posture' => 'WARM_BUILD', 'draftBy' => 'claude'],
            'writes' => [],
        ]),
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/dev/generate/{$this->session->id}", ['context' => 'he seems warm', 'api' => 'claude'])
        ->assertOk()
        ->assertJsonPath('draft', 'aw that means a lot babe, tell me what made it long 🙈')
        ->assertJsonPath('telemetry.posture', 'WARM_BUILD');

    // Draft-log row persisted, not sent.
    $msg = AichMessage::query()->where('session_id', $this->session->id)->first();
    expect($msg)->not->toBeNull()
        ->and($msg->response_text)->toContain('that means a lot')
        ->and((bool) $msg->was_sent)->toBeFalse()
        ->and($msg->send_state)->toBe('draft');
});

it('sends the exact persona + conversation to the engine', function () {
    Http::fake(['*/generate' => Http::response(['draft' => 'ok', 'strategy' => null, 'telemetry' => null])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/dev/generate/{$this->session->id}", ['context' => 'pitch now'])
        ->assertOk();

    Http::assertSent(function ($request) {
        $b = $request->data();

        return str_ends_with($request->url(), '/generate')
            && $b['model']['name'] === 'Camila'
            && str_contains($b['model']['prompt'], 'You are Camila')
            && $b['context'] === 'pitch now'
            && collect($b['session']['messages'])->contains(fn ($m) => str_contains($m['text'], 'my day was long'));
    });
});

it('requires authentication', function () {
    // Web route → unauthenticated requests redirect to login rather than 401.
    $this->post("/dev/generate/{$this->session->id}")->assertRedirect(route('login'));
});
