<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * Conversations is a thin shell — all chat data (chats, messages, fan intel) is
 * fetched LIVE from OnlyFans client-side via OnlyFansChatController; nothing is
 * persisted. The selected creator comes from the app-wide creator context
 * (client store + shared `creators` prop). Its one prop is config the client mirrors.
 */
class ConversationController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Conversations', [
            // The quiet gap that ends a conversation. The composer lists the rejected drafts
            // the AI is still avoiding, which must match DraftRejectionService::active().
            'sessionGapHours' => (int) config('services.engine.session_gap_hours', 12),
        ]);
    }
}
