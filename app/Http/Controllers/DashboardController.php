<?php

namespace App\Http\Controllers;

use App\Services\Dashboard\DashboardService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __invoke(Request $request, DashboardService $dashboard): Response
    {
        return Inertia::render('Dashboard', [
            'dashboard' => $dashboard->build($request->user(), (string) $request->query('period', 'Today')),
        ]);
    }
}
