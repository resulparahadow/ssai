// One-shot: regenerate the doctrine push SQL from the current code-canonical DEFAULT_TRAINING.
// Run: node gen_push_sql.js
const fs=require('fs'),c=require('crypto');
const {DEFAULT_TRAINING}=new Function(fs.readFileSync('js/doctrine.js','utf8')+'\nreturn {DEFAULT_TRAINING};')();
const sha=c.createHash('sha256').update(DEFAULT_TRAINING,'utf8').digest('hex');
const b64=Buffer.from(DEFAULT_TRAINING,'utf8').toString('base64');
const ver=(DEFAULT_TRAINING.match(/GLOBAL AGENCY TRAINING \(v([0-9.]+)\)/)||[])[1];
const sql=[
 '-- doctrine_v'+ver+'_push.sql  (regenerated)',
 '-- Pushes the current code-canonical doctrine to the RLS-locked __global_training__ row.',
 '-- Run in the Supabase Dashboard SQL Editor (runs as postgres, bypasses RLS).',
 '-- SUPERSEDES doctrine_v0.4.5.0_push.sql -- this is the full current doctrine',
 '-- (all v0.4.5.0 changes + the v0.4.5.1 multiplier-ref fix + PART 1 redundancy cut).',
 '--',
 '-- Doctrine version : v'+ver,
 '-- SHA256 (runtime) : '+sha,
 '-- Char length      : '+DEFAULT_TRAINING.length,
 '--',
 '-- After running, reload the app: the yellow drift warning should clear.',
 '',
 'UPDATE aich_models',
 "SET prompt = convert_from(decode('"+b64+"', 'base64'), 'UTF8'),",
 "    tier = 'system'",
 "WHERE name = '__global_training__';",
 '',
 '-- Optional verification (header should read v'+ver+'):',
 "-- SELECT left(prompt, 55) AS header, length(prompt) AS chars FROM aich_models WHERE name = '__global_training__';",
 ''
].join('\n');
fs.writeFileSync('doctrine_v'+ver+'_push.sql',sql);
console.log('wrote doctrine_v'+ver+'_push.sql | bytes:',sql.length,'| sha:',sha,'| docChars:',DEFAULT_TRAINING.length,'| b64Chars:',b64.length);
