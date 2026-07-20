<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * Conversations is a thin shell — all chat data (chats, messages, fan intel) is
 * fetched LIVE from OnlyFans client-side via OnlyFansChatController; nothing is
 * persisted. The selected creator comes from the app-wide creator context
 * (client store + shared `creators` prop), so the shell needs no props.
 */
class ConversationController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Conversations');
    }
}
