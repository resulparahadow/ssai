<?php

return [
    /*
     | Period revenue goal used by the Overview "pace vs target" widget. A real
     | per-creator / per-chatter target system arrives with the analytics spec;
     | this single agency-wide number is the Phase-1 placeholder.
     */
    'revenue_goal' => env('DASHBOARD_REVENUE_GOAL', 10000),
];
