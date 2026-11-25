<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * The Scripts management page is a thin shell, like Media Vault: the creator comes from the
 * app-wide creator context and every byte is fetched from `onlyfans/{model}/scripts…`.
 * Gated by `can:manage-team` in the route file.
 */
class ScriptsPageController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Scripts');
    }
}
