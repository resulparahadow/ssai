<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One agency-wide setting changed from the UI. Read through a service, never per-request raw. */
class AppSetting extends Model
{
    protected $primaryKey = 'key';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'key',
        'value',
        'updated_by',
    ];
}
