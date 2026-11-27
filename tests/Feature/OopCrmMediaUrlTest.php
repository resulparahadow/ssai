<?php

use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Support\Facades\Http;

// OopCRM's OFAPI layer wraps every media url in its own download route (verified live
// 2026-11-27). The client unwraps it so the app sees the bare CDN url, as with OnlyFansAPI.

const OOP_BASE = 'https://app.oopcrm.com/api/v1/ofapi';

function oopWrapped(string $cdn): string
{
    return OOP_BASE.'/acct_abc/media/download/'.rawurlencode($cdn);
}

it('unwraps OopCRM media download urls in a JSON response', function () {
    $cdn = 'https://cdn2.onlyfans.com/files/1/19/abc/960x960_x.jpg?Tag=2&u=1&Policy=p&Signature=s&Key-Pair-Id=k';
    Http::fake([OOP_BASE.'/*' => Http::response(['data' => ['list' => [[
        'id' => 12253860936953,
        'price' => 12.5,
        'media' => [['id' => 1, 'files' => ['full' => ['url' => oopWrapped($cdn)], 'thumb' => ['url' => oopWrapped($cdn)]]]],
    ]]], '_pagination' => ['next_page' => OOP_BASE.'/acct_abc/chats/1/messages?limit=20&first_id=5']])]);

    $json = (new OnlyFansService('key', OOP_BASE))->listMessages('acct_abc', '1')->json();

    expect(data_get($json, 'data.list.0.media.0.files.full.url'))->toBe($cdn)
        ->and(data_get($json, 'data.list.0.media.0.files.thumb.url'))->toBe($cdn)
        ->and(data_get($json, 'data.list.0.id'))->toBe(12253860936953)
        ->and(data_get($json, 'data.list.0.price'))->toBe(12.5)
        ->and(data_get($json, '_pagination.next_page'))->toBe(OOP_BASE.'/acct_abc/chats/1/messages?limit=20&first_id=5');
});

it('leaves OnlyFansAPI responses and the DRM route untouched', function () {
    $cdn = 'https://cdn2.onlyfans.com/files/a.jpg?Tag=2';
    $drm = OOP_BASE.'/acct_abc/media/download/drm/123';
    Http::fake(['https://app.onlyfansapi.com/api/*' => Http::response(['data' => ['url' => $cdn, 'drm' => $drm]])]);

    $json = (new OnlyFansService('key', 'https://app.onlyfansapi.com/api'))->listVaultMedia('acct_abc')->json();

    expect(data_get($json, 'data.url'))->toBe($cdn)->and(data_get($json, 'data.drm'))->toBe($drm);
});
