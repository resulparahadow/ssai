<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Models\AppSetting;
use App\Services\Integrations\ChatProvider;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Admin-only switch for the backend every OnlyFans call goes through: OnlyFansAPI or OopCRM's
 * OFAPI-compatible layer. Only the CHOICE is stored (app_settings); keys stay in .env and the
 * page only learns whether each one is set.
 */
class IntegrationsController extends Controller
{
    public function edit(ChatProvider $providers): Response
    {
        $row = AppSetting::query()->find('chat_provider');

        return Inertia::render('settings/Integrations', [
            'active' => $providers->active(),
            'providers' => array_map(fn (string $p) => [
                'key' => $p,
                'label' => ChatProvider::LABELS[$p],
                'baseUrl' => $providers->connection($p)['base_url'],
                'configured' => $providers->configured($p),
                'webhookSecret' => $providers->connection($p)['webhook_secret'] !== '',
            ], ChatProvider::ALL),
            'updatedAt' => $row?->updated_at?->toIso8601String(),
        ]);
    }

    public function update(Request $request, ChatProvider $providers): RedirectResponse
    {
        $data = $request->validate(['provider' => ['required', Rule::in(ChatProvider::ALL)]]);

        if (! $providers->configured($data['provider'])) {
            throw ValidationException::withMessages([
                'provider' => ChatProvider::LABELS[$data['provider']].' has no API key on the server yet.',
            ]);
        }

        $providers->set($data['provider'], $request->user()?->id);

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => 'Chats now go through '.ChatProvider::LABELS[$data['provider']].'.',
        ]);

        return to_route('integrations.edit');
    }

    /** One `GET accounts` through the chosen provider (no switch), reported as a toast. */
    public function test(Request $request, ChatProvider $providers): RedirectResponse
    {
        $data = $request->validate(['provider' => ['required', Rule::in(ChatProvider::ALL)]]);
        $label = ChatProvider::LABELS[$data['provider']];
        $connection = $providers->connection($data['provider']);

        if ($connection['key'] === '') {
            Inertia::flash('toast', ['type' => 'error', 'message' => "{$label}: no API key on the server."]);

            return back();
        }

        try {
            $res = (new OnlyFansService($connection['key'], $connection['base_url']))->listAccounts();
        } catch (ConnectionException) {
            Inertia::flash('toast', ['type' => 'error', 'message' => "{$label}: could not connect."]);

            return back();
        }

        if ($res->successful()) {
            $body = $res->json();
            $count = is_array($body) ? count(array_is_list($body) ? $body : (array) ($body['data'] ?? [])) : 0;
            Inertia::flash('toast', ['type' => 'success', 'message' => "{$label} works: {$count} creator account(s) visible."]);
        } else {
            $reason = (string) ($res->json('message') ?? $res->json('error') ?? 'HTTP '.$res->status());
            Inertia::flash('toast', ['type' => 'error', 'message' => "{$label}: {$reason}"]);
        }

        return back();
    }
}
