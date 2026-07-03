<?php

namespace App\Http\Controllers;

use App\Services\Dashboard\AiUsageService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class AiUsageController extends Controller
{
    public function __invoke(Request $request, AiUsageService $usage): Response
    {
        return Inertia::render('AiUsage', [
            'usage' => $usage->build($request->user(), (string) $request->query('period', '7d')),
        ]);
    }
}
