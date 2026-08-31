<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * Renders the agency Spender-Brackets analytics page. Manager/admin only (route
 * is `manage-team` gated). The page reads the shared `creators` prop and fetches
 * each creator's spenders live client-side via `models/{model}/of/spenders`.
 */
class SpenderAnalyticsController extends Controller
{
    public function __invoke(): Response
    {
        return Inertia::render('Spenders');
    }
}
