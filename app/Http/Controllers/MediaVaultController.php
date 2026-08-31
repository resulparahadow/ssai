<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * Media Vault is a thin shell — like Conversations, every byte is fetched LIVE from
 * OnlyFans client-side via OnlyFansChatController; nothing is persisted. The selected
 * creator comes from the app-wide creator context (client store + shared `creators`
 * prop), so the shell needs no props.
 */
class MediaVaultController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('MediaVault');
    }
}
