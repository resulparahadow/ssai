<?php

namespace App\Http\Controllers;

use App\Models\AichMessage;
use App\Models\AichSession;
use App\Services\Engine\EngineClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Runs the legacy engine for a conversation and persists the draft. The heavy
 * IP (posture/strategy/generation) lives in the Node sidecar; this controller
 * just gathers the session, calls the engine, and records the draft-log row.
 */
class GenerationController extends Controller
{
    public function generate(Request $request, AichSession $session, EngineClient $engine): JsonResponse
    {
        $data = $request->validate([
            'context' => 'nullable|string',
            'api' => 'nullable|in:claude,auto,mistral',
            'sender' => 'nullable|in:customer,ppv',
        ]);

        $result = $engine->generateForSession($session, $data);

        AichMessage::create([
            'session_id' => $session->id,
            'user_id' => $request->user()->id,
            'creator_model' => $session->creator_model,
            'customer_username' => $session->customer_username,
            'response_text' => $result['draft'] ?? '',
            'input_messages' => $session->messages,
            'was_sent' => false,
            'api_used' => $data['api'] ?? 'claude',
            'send_state' => 'draft',
        ]);

        return response()->json([
            'draft' => $result['draft'] ?? '',
            'strategy' => $result['strategy'] ?? null,
            'telemetry' => $result['telemetry'] ?? null,
        ]);
    }
}
