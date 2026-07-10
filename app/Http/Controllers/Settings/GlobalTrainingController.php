<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Services\Doctrine\DoctrineService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Admin-only editor for the global agency doctrine ("Global Training"). The active
 * override lives in the doctrines table; when there is none the engine's canonical
 * DEFAULT_TRAINING is shown. Restores the legacy Settings → Global Training tab.
 */
class GlobalTrainingController extends Controller
{
    public function edit(DoctrineService $doctrine): Response
    {
        $active = $doctrine->active();

        if ($active !== null) {
            [$content, $version, $sha, $updatedAt, $isDefault] =
                [$active->prompt, $active->version, $active->sha256, $active->updated_at?->toIso8601String(), false];
        } else {
            $default = $doctrine->defaultDoctrine();
            [$content, $version, $sha, $updatedAt, $isDefault] =
                [$default['prompt'], $default['version'], $default['sha256'], null, true];
        }

        $integrity = $doctrine->checkIntegrity($content);

        return Inertia::render('settings/GlobalTraining', [
            'content' => $content,
            'version' => $version,
            'shaShort' => substr($sha, 0, 12),
            'words' => $integrity['words'],
            'integrity' => [
                'ok' => $integrity['ok'],
                'reason' => $integrity['reason'],
                'missing' => $integrity['missing'],
            ],
            'updatedAt' => $updatedAt,
            'isDefault' => $isDefault,
        ]);
    }

    public function update(Request $request, DoctrineService $doctrine): RedirectResponse
    {
        $validated = $request->validate([
            'content' => ['required', 'string'],
            'force' => ['sometimes', 'boolean'],
        ]);

        $check = $doctrine->checkIntegrity($validated['content']);

        if (! $check['ok'] && ! $request->boolean('force')) {
            throw ValidationException::withMessages([
                'content' => $check['reason'].($check['missing'] !== []
                    ? ' (missing: '.implode(', ', $check['missing']).')'
                    : ''),
            ]);
        }

        $doctrine->saveCustom(
            $validated['content'],
            'Edited in settings by '.$request->user()->email.' on '.now()->toDateString(),
        );

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Global training saved.')]);

        return to_route('global-training.edit');
    }

    public function reset(DoctrineService $doctrine): RedirectResponse
    {
        $doctrine->resetToDefault();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Global training reset to default.')]);

        return to_route('global-training.edit');
    }
}
