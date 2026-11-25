<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AuthorizesCreator;
use App\Models\AichMessageTag;
use App\Models\AichModel;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/** Per-message PPV-kind tags (chat PPV / MPPV / free preview). Local metadata; no OnlyFans call. */
class MessageTagController extends Controller
{
    use AuthorizesCreator;

    public function index(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        return response()->json(['tags' => (object) AichMessageTag::forChat($model->name, $chat)]);
    }

    public function update(Request $request, AichModel $model, string $chat, string $message): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, ['tag' => ['required', 'string', Rule::in(AichMessageTag::TAGS)]]);

        $row = AichMessageTag::withoutGlobalScopes()->updateOrCreate(
            ['creator_model' => $model->name, 'chat_id' => $chat, 'message_id' => $message],
            ['tag' => $data['tag'], 'user_id' => $request->user()->id],
        );

        return response()->json(['tag' => $row->tag]);
    }

    public function destroy(Request $request, AichModel $model, string $chat, string $message): Response
    {
        $this->authorizeCreator($request, $model);

        AichMessageTag::withoutGlobalScopes()
            ->where('creator_model', $model->name)->where('chat_id', $chat)->where('message_id', $message)
            ->delete();

        return response()->noContent();
    }
}
