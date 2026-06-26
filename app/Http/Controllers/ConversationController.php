<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Conversations is a thin shell — all chat data (chats, messages, fan intel) is
 * fetched LIVE from OnlyFans client-side via OnlyFansChatController; nothing is
 * persisted. The shell only needs to know which creator is initially selected;
 * the sidebar's shared `creators` prop carries the model id used to build the
 * live `/onlyfans/{model}/…` URLs.
 */
class ConversationController extends Controller
{
    public function index(Request $request): Response
    {
        return Inertia::render('Conversations', [
            'selectedCreator' => $request->query('creator'),
        ]);
    }
}
