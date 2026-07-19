<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Media Vault is a thin shell — like Conversations, every byte is fetched LIVE from
 * OnlyFans client-side via OnlyFansChatController; nothing is persisted. The shell only
 * needs the initially-selected creator; the sidebar's shared `creators` prop carries the
 * model id used to build the live `/onlyfans/{model}/…` URLs.
 */
class MediaVaultController extends Controller
{
    public function index(Request $request): Response
    {
        return Inertia::render('MediaVault', [
            'selectedCreator' => $request->query('creator'),
        ]);
    }
}
