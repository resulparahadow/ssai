<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Manager-reviewed corrections. On approval, proposed_rules are APPENDED to the
 * creator model's feedback_rules (legacy v0.4.1.4 behaviour).
 */
class AichFeedbackQueue extends Model
{
    protected $table = 'aich_feedback_queue';

    protected $fillable = [
        'creator_model',
        'proposed_rules',
        'source_message_ids',
        'status',
        'rejection_count',
        'resolved_at',
        'resolved_by',
    ];

    protected $casts = [
        'proposed_rules' => 'array',
        'source_message_ids' => 'array',
        'rejection_count' => 'integer',
        'resolved_at' => 'datetime',
    ];
}
