<?php

/*
|--------------------------------------------------------------------------
| Production seeding
|--------------------------------------------------------------------------
| Values consumed by Database\Seeders\ProductionSeeder. Read through config()
| (not env() directly) so they resolve correctly once config is cached.
| The first admin's credentials come from the environment, never from code.
*/

return [
    'admin' => [
        'name' => env('ADMIN_NAME', 'Admin'),
        'email' => env('ADMIN_EMAIL', 'admin@smartstars.test'),
        'password' => env('ADMIN_PASSWORD'),
    ],

    'test_model' => [
        'name' => env('TEST_MODEL_NAME', 'Test'),
        // Optional OnlyFans acct_XXXX link; leave unset to connect later in the UI.
        'of_account_id' => env('TEST_MODEL_OF_ACCOUNT_ID'),
    ],
];
