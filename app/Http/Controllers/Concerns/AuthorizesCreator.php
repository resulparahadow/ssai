<?php

namespace App\Http\Controllers\Concerns;

use App\Models\AichModel;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * Shared by the chatter-facing per-creator controllers (`onlyfans/{model}/…`): the row-level
 * access check (a chatter may only touch their assigned creators) and the JSON-422 validator
 * these fetch-driven routes need — they are not under `api/*`, so a plain `validate()` would
 * answer a ValidationException with a 302 redirect instead of JSON.
 */
trait AuthorizesCreator
{
    /** Row-level access check (chatter → assigned only; managers/admins see every creator). */
    protected function authorizeCreator(Request $request, AichModel $model): void
    {
        $user = $request->user();
        if (! $user->canSeeAllCreators() && ! in_array($model->name, $user->assignedCreatorModels(), true)) {
            abort(403, 'You are not assigned to this creator.');
        }
    }

    /**
     * Validate and return a real JSON 422 on failure (first message under `error`, the full
     * bag under `errors`) — the shape every `ofApi` client call already reads.
     *
     * @param  array<string, mixed>  $rules
     * @return array<string, mixed>
     */
    protected function validateJson(Request $request, array $rules): array
    {
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            throw new HttpResponseException(
                response()->json(['error' => $validator->errors()->first(), 'errors' => $validator->errors()->toArray()], 422)
            );
        }

        return $validator->validated();
    }
}
