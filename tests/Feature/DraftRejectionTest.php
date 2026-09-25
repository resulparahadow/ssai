<?php

use App\Models\AichDraftRejection;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'services.onlyfans.key' => 'test-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
        'services.engine.url' => 'http://127.0.0.1:8787',
        'services.engine.session_gap_hours' => 12,
    ]);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->url = "/onlyfans/{$this->model->id}/chats/101/rejections";
});

function assignedChatter(string $creator): User
{
    $user = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $user->id, 'creator_model' => $creator]);

    return $user;
}

/** A rejection stamped `$minutesAgo` in the past (created_at is what the active-window rule reads). */
function rejectionAgo(int $minutesAgo, string $feedback, string $chat = '101', string $creator = 'Camila'): AichDraftRejection
{
    test()->travelTo(now()->subMinutes($minutesAgo));
    $row = AichDraftRejection::create([
        'creator_model' => $creator, 'chat_id' => $chat, 'draft' => "draft for {$feedback}", 'feedback' => $feedback,
    ]);
    test()->travelBack();

    return $row;
}

/** A thread message `$minutesAgo` in the past, in the shape Conversations.vue posts to generate. */
function msgAgo(int $minutesAgo, string $from = 'fan'): array
{
    return ['from' => $from, 'text' => 'hey', 'time' => now()->subMinutes($minutesAgo)->toIso8601String()];
}

/** Runs a live generate and returns the rejections the engine received as legacy `_sessionFeedback`. */
function feedbackSentToEngine(array $messages): array
{
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => null, 'telemetry' => null, 'usage' => []]),
    ]);

    test()->actingAs(User::factory()->admin()->create())
        ->postJson('/onlyfans/'.AichModel::first()->id.'/chats/101/generate', ['messages' => $messages, 'customer' => ['id' => '101']])
        ->assertOk();

    $sent = Http::recorded(fn ($r) => str_contains($r->url(), '8787'))->first()[0];

    return data_get($sent->data(), 'session._sessionFeedback') ?? [];
}

// ---- recording / listing / removing ------------------------------------------------------

it('records a rejection with the draft, the reason and who rejected it', function () {
    $chatter = assignedChatter('Camila');

    $this->actingAs($chatter)
        ->postJson($this->url, ['draft' => 'want to see something special?', 'feedback' => "don't sell, ask about his dog"])
        ->assertCreated()
        ->assertJsonPath('rejection.feedback', "don't sell, ask about his dog")
        ->assertJsonPath('rejection.draft', 'want to see something special?')
        ->assertJsonPath('rejection.by', $chatter->name);

    $row = AichDraftRejection::sole();
    expect($row->creator_model)->toBe('Camila')
        ->and($row->chat_id)->toBe('101')
        ->and($row->user_id)->toBe($chatter->id);
});

it('requires a reason (JSON 422)', function () {
    $this->actingAs(assignedChatter('Camila'))
        ->postJson($this->url, ['draft' => 'hey'])
        ->assertStatus(422);

    expect(AichDraftRejection::count())->toBe(0);
});

it('lists only this chat\'s rejections, oldest first', function () {
    rejectionAgo(30, 'first');
    rejectionAgo(10, 'second');
    rejectionAgo(20, 'other chat', chat: '102');
    AichModel::create(['name' => 'Nova']);
    rejectionAgo(5, 'other creator', creator: 'Nova');

    $this->actingAs(assignedChatter('Camila'))
        ->getJson($this->url)
        ->assertOk()
        ->assertJsonCount(2, 'rejections')
        ->assertJsonPath('rejections.0.feedback', 'first')
        ->assertJsonPath('rejections.1.feedback', 'second');
});

it('keeps chatters out of creators they are not assigned to', function () {
    $row = rejectionAgo(5, 'mine');
    $stranger = User::factory()->chatter()->create();

    $this->actingAs($stranger)->getJson($this->url)->assertForbidden();
    $this->actingAs($stranger)->postJson($this->url, ['draft' => 'x', 'feedback' => 'y'])->assertForbidden();
    $this->actingAs($stranger)->deleteJson("{$this->url}/{$row->id}")->assertForbidden();

    // Unscoped: still acting as the stranger, whose creator-access scope hides this row.
    expect(AichDraftRejection::withoutGlobalScopes()->count())->toBe(1);
});

it('removes a rejection', function () {
    $row = rejectionAgo(5, 'stale');

    $this->actingAs(assignedChatter('Camila'))
        ->deleteJson("{$this->url}/{$row->id}")
        ->assertOk();

    expect(AichDraftRejection::count())->toBe(0);
});

it('will not remove a rejection that belongs to another chat', function () {
    $other = rejectionAgo(5, 'not yours', chat: '102');

    $this->actingAs(assignedChatter('Camila'))
        ->deleteJson("{$this->url}/{$other->id}")
        ->assertNotFound();

    expect(AichDraftRejection::count())->toBe(1);
});

// ---- what reaches the AI ------------------------------------------------------------------

it('sends the conversation\'s rejections to the AI in legacy\'s shape', function () {
    rejectionAgo(10, "don't sell, ask about his dog");

    expect(feedbackSentToEngine([msgAgo(20), msgAgo(5)]))->toBe([
        ['feedback' => "don't sell, ask about his dog", 'rejectedMsg' => "draft for don't sell, ask about his dog"],
    ]);
});

it('drops rejections from before the chat went quiet for 12h+', function () {
    rejectionAgo(2 * 24 * 60, 'old conversation');
    rejectionAgo(3, 'this conversation');

    $sent = feedbackSentToEngine([msgAgo(2 * 24 * 60 - 1), msgAgo(10), msgAgo(1)]);

    expect(array_column($sent, 'feedback'))->toBe(['this conversation']);
});

it('drops every rejection once the chat has been quiet for 12h+ up to now', function () {
    rejectionAgo(13 * 60, 'yesterday');

    expect(feedbackSentToEngine([msgAgo(13 * 60 + 1)]))->toBeEmpty();
});

it('keeps a rejection made while re-engaging a quiet fan', function () {
    // Fan went quiet 20h ago; the chatter rejected a re-engagement draft 30 min ago, sent a
    // message 25 min ago, and the fan replied. That rejection belongs to THIS conversation.
    rejectionAgo(30, 'too needy');

    $sent = feedbackSentToEngine([msgAgo(20 * 60), msgAgo(25, 'creator'), msgAgo(5)]);

    expect(array_column($sent, 'feedback'))->toBe(['too needy']);
});

it('sends at most the 5 newest, oldest first', function () {
    foreach ([70, 60, 50, 40, 30, 20, 10] as $i => $ago) {
        rejectionAgo($ago, 'r'.($i + 1));
    }

    $sent = feedbackSentToEngine([msgAgo(80), msgAgo(45), msgAgo(15), msgAgo(1)]);

    expect(array_column($sent, 'feedback'))->toBe(['r3', 'r4', 'r5', 'r6', 'r7']);
});

it('gives the Conversations page the session gap, so its list matches what the AI gets', function () {
    config(['services.engine.session_gap_hours' => 8]);

    $this->actingAs(assignedChatter('Camila'))
        ->get('/conversations')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('Conversations')
            ->where('sessionGapHours', 8));
});
