<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

it('renders the Media Vault shell (creator comes from the shared context)', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get('/media-vault')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('MediaVault')
            ->where('creators.0.name', 'Camila'));
});

// ---- Vault lists -----------------------------------------------------------

it('lists vault lists normalised with counts and hasMore', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'list' => [[
                'id' => 12, 'type' => 'custom', 'name' => 'Faves',
                'hasMedia' => true, 'canUpdate' => true, 'canDelete' => true,
                'videosCount' => 2, 'photosCount' => 5, 'gifsCount' => 0, 'audiosCount' => 1,
            ]],
            'hasMore' => true,
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault/lists?limit=24")
        ->assertOk()
        ->assertJsonPath('lists.0.id', '12')
        ->assertJsonPath('lists.0.name', 'Faves')
        ->assertJsonPath('lists.0.photosCount', 5)
        ->assertJsonPath('hasMore', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/media/vault/lists') && str_contains($r->url(), 'limit=24'));
});

it('creates a vault list', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['id' => 20, 'type' => 'custom', 'name' => 'New folder', 'hasMedia' => false, 'canUpdate' => true, 'canDelete' => true, 'videosCount' => 0, 'photosCount' => 0, 'gifsCount' => 0, 'audiosCount' => 0],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/media/vault/lists", ['name' => 'New folder'])
        ->assertOk()
        ->assertJsonPath('list.id', '20')
        ->assertJsonPath('list.name', 'New folder');

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/acct_cam/media/vault/lists') && $r['name'] === 'New folder');
});

it('rejects creating a vault list with no name as json 422', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/media/vault/lists", [])
        ->assertStatus(422)
        ->assertJsonStructure(['error']);
});

it('shows a vault list with its media normalised', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'id' => 12, 'type' => 'custom', 'name' => 'Faves', 'hasMedia' => true,
            'canUpdate' => true, 'canDelete' => true, 'videosCount' => 0, 'photosCount' => 1, 'gifsCount' => 0, 'audiosCount' => 0,
            'medias' => [[
                'id' => 7, 'type' => 'photo', 'canView' => true,
                'files' => ['full' => ['url' => 'https://cdn2.onlyfans.com/x.jpg'], 'thumb' => ['url' => 'https://cdn2.onlyfans.com/t.jpg']],
            ]],
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault/lists/12")
        ->assertOk()
        ->assertJsonPath('list.id', '12')
        ->assertJsonPath('list.medias.0.id', '7')
        ->assertJsonPath('list.medias.0.full', 'https://cdn2.onlyfans.com/x.jpg');

    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/acct_cam/media/vault/lists/12'));
});

it('renames a vault list via PUT', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['id' => 12, 'type' => 'custom', 'name' => 'Renamed', 'hasMedia' => false, 'canUpdate' => true, 'canDelete' => true, 'videosCount' => 0, 'photosCount' => 0, 'gifsCount' => 0, 'audiosCount' => 0],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->putJson("/onlyfans/{$this->model->id}/media/vault/lists/12", ['name' => 'Renamed'])
        ->assertOk()
        ->assertJsonPath('list.name', 'Renamed');

    Http::assertSent(fn ($r) => $r->method() === 'PUT' && str_ends_with($r->url(), '/acct_cam/media/vault/lists/12') && $r['name'] === 'Renamed');
});

// The OF API uses `media_ids` on add but `mediaIds` on remove — an intentional
// asymmetry the service translates. These guard that we send the right key each way.
it('adds media to a list with the media_ids body key', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['message' => 'Media added to list successfully.'])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/media/vault/lists/12/media", ['mediaIds' => ['7', '8']])
        ->assertOk()
        ->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_ends_with($r->url(), '/acct_cam/media/vault/lists/12/media')
        && $r['media_ids'] === ['7', '8']);
});

it('removes media from a list with the mediaIds body key', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 12]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->deleteJson("/onlyfans/{$this->model->id}/media/vault/lists/12/media", ['mediaIds' => ['7']])
        ->assertOk()
        ->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'DELETE'
        && str_ends_with($r->url(), '/acct_cam/media/vault/lists/12/media')
        && $r['mediaIds'] === ['7']);
});

// Vault media come back as fansapi.com presigned urls (browser-loadable) — not IP-locked
// cdn*.onlyfans.com. `direct` tells the frontend to skip the proxy (whose SSRF guard 400s
// a fansapi host). Regression guard for the "media 400" bug.
it('flags fansapi presigned vault media as direct and onlyfans media as proxied', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'list' => [
                ['id' => 1, 'type' => 'photo', 'canView' => true, 'files' => ['thumb' => ['url' => 'https://cdn.fansapi.com/of/cdn2/files/x.jpg?X-Amz-Signature=abc']]],
                ['id' => 2, 'type' => 'photo', 'canView' => true, 'files' => ['thumb' => ['url' => 'https://cdn2.onlyfans.com/files/y.jpg']]],
            ],
            'hasMore' => false,
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault")
        ->assertOk()
        ->assertJsonPath('items.0.direct', true)
        ->assertJsonPath('items.1.direct', false);
});

// The vault LIST omits a video's playable source; the single-media detail endpoint resolves it
// (via videoSources) so the lightbox plays non-DRM videos instead of the DRM fallback.
it('returns a single vault media item with a resolved video source', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'id' => 55, 'type' => 'video', 'canView' => true, 'duration' => 12,
            'videoSources' => ['720' => 'https://cdn.fansapi.com/of/v720.mp4?X-Amz-Signature=s'],
            'files' => ['preview' => ['url' => 'https://cdn.fansapi.com/of/poster.jpg?X-Amz-Signature=s']],
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault/55")
        ->assertOk()
        ->assertJsonPath('item.id', '55')
        ->assertJsonPath('item.type', 'video')
        ->assertJsonPath('item.source', 'https://cdn.fansapi.com/of/v720.mp4?X-Amz-Signature=s')
        ->assertJsonPath('item.direct', true);

    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/acct_cam/media/vault/55'));
});

// ---- Upload to vault -------------------------------------------------------

it('uploads a file into the vault (async) and returns id/status', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['status' => 'pending', 'prefixed_id' => 'ofapi_media_v1'], 202)]);

    $this->actingAs(User::factory()->admin()->create())
        ->post("/onlyfans/{$this->model->id}/media/vault", [
            'file' => UploadedFile::fake()->create('shot.jpg', 50, 'image/jpeg'),
        ])
        ->assertOk()
        ->assertJsonPath('id', 'ofapi_media_v1')
        ->assertJsonPath('status', 'pending');

    // Vault upload posts to media/vault — NOT media/upload (the CDN single-use path).
    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/acct_cam/media/vault'));
});

it('uploads to the vault from a url', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['status' => 'pending', 'prefixed_id' => 'ofapi_media_v2'], 202)]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/media/vault", ['file_url' => 'https://example.com/clip.mp4'])
        ->assertOk()
        ->assertJsonPath('id', 'ofapi_media_v2');

    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_ends_with($r->url(), '/acct_cam/media/vault')
        && $r['file_url'] === 'https://example.com/clip.mp4'
        && $r['async'] === 'true');
});

it('rejects a vault upload with neither file nor url as json 422', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/media/vault", [])
        ->assertStatus(422)
        ->assertJsonStructure(['error']);
});

// ---- Deletes (manager+) ----------------------------------------------------

it('deletes vault media at the delete-media path (manager+), with mediaIds', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);

    $this->actingAs(User::factory()->manager()->create())
        ->deleteJson("/onlyfans/{$this->model->id}/media/vault/delete-media", ['mediaIds' => ['7']])
        ->assertOk()
        ->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'DELETE'
        && str_ends_with($r->url(), '/acct_cam/media/vault/delete-media')
        && $r['mediaIds'] === ['7']);
});

it('deletes a vault list (manager+)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);

    $this->actingAs(User::factory()->manager()->create())
        ->deleteJson("/onlyfans/{$this->model->id}/media/vault/lists/12")
        ->assertOk()
        ->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/acct_cam/media/vault/lists/12'));
});

// ---- Access matrix ---------------------------------------------------------

it('bars an assigned chatter from deleting vault media or lists', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);

    $this->actingAs($chatter)->deleteJson("/onlyfans/{$this->model->id}/media/vault/delete-media", ['mediaIds' => ['7']])->assertForbidden();
    $this->actingAs($chatter)->deleteJson("/onlyfans/{$this->model->id}/media/vault/lists/12")->assertForbidden();

    Http::assertNothingSent();
});

it('lets an assigned chatter browse and organise the vault', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['list' => [], 'hasMore' => false]])]);
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);

    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/media/vault/lists")->assertOk();
});

it('scopes vault access: an unassigned chatter is forbidden', function () {
    $chatter = User::factory()->chatter()->create();

    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/media/vault/lists")->assertForbidden();
});

// Regression: static/`lists` segments must resolve before the GET media/vault/{media} wildcard.
it('routes media/vault/lists without the {media} wildcard capturing it', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['list' => [], 'hasMore' => false]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault/lists")
        ->assertOk();

    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/acct_cam/media/vault/lists'));
});
