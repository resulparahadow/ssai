'use strict';
/**
 * Guards the GET /doctrine endpoint (canonical default doctrine the Global Training
 * settings page reads when no override is active). Spawns the engine on a spare port,
 * fetches /doctrine, and asserts the canonical sha256 + a parseable version + that the
 * returned prompt length matches `len`.  Run:  node engine/doctrine_check.js
 */
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.ENGINE_PORT || '8799';
const CANONICAL_SHA = 'a1bcbcef27519268fd005622a9e124965a4b8e7732c24cc5303ccda0760ade0e';

const srv = spawn('node', [__dirname + '/server.js'], {
    env: { ...process.env, ENGINE_PORT: String(PORT) },
    stdio: 'ignore',
});

function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
        });
        req.on('error', reject);
    });
}

async function waitReady(retries = 50) {
    for (let i = 0; i < retries; i++) {
        try {
            await get('/health');
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    throw new Error('engine did not start');
}

(async () => {
    try {
        await waitReady();
        const { status, json } = await get('/doctrine');
        assert.strictEqual(status, 200, 'GET /doctrine returns 200');
        assert.strictEqual(json.sha256, CANONICAL_SHA, 'canonical sha256 matches');
        assert.ok(json.len > 100000 && json.prompt.length === json.len, 'len matches prompt length');
        assert.ok(/^v\d/.test(json.version), 'version parses (' + json.version + ')');
        console.log(
            '✓ GET /doctrine: version ' + json.version + ', len ' + json.len + ', sha ' + json.sha256.slice(0, 12) + '…',
        );
        srv.kill();
        process.exit(0);
    } catch (e) {
        console.error('✗ doctrine_check:', e.message);
        srv.kill();
        process.exit(1);
    }
})();
