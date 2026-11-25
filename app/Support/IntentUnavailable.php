<?php

namespace App\Support;

use RuntimeException;

/** The thread lacks what an intent button needs; the message is shown to the chatter. */
class IntentUnavailable extends RuntimeException {}
