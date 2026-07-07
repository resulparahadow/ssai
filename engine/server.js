'use strict';
/**
 * SSAI engine HTTP service. Laravel posts a legacy-shaped payload and gets back
 * the draft + strategy + telemetry + captured DB writes. Keys come from env
 * (ANTHROPIC_API_KEY / OPENROUTER_API_KEY) — never from the client.
 *
 *   PORT (default 8787) · run: node engine/server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateDraft } = require('./runGenerate');
const { loadEngine } = require('./loadEngine');

// Convenience: load provider keys from the project .env if not already in the
// environment, so `node engine/server.js` works without exporting them.
(function loadDotenvKeys() {
    const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'];
    if (keys.every((k) => process.env[k])) return;
    try {
        const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        for (const k of keys) {
            if (process.env[k]) continue;
            const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
            if (m) process.env[k] = m[1].trim().replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env — rely on the real environment */ }
})();

const PORT = parseInt(process.env.ENGINE_PORT || '8787', 10);
// Bind host: localhost by default (safe for local dev); in Docker set
// ENGINE_HOST=0.0.0.0 so sibling containers can reach the engine.
const HOST = process.env.ENGINE_HOST || '127.0.0.1';

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => { data += c; if (data.length > 5e6) req.destroy(); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url === '/health') {
            const { eng } = loadEngine();
            return json(res, 200, { ok: true, doctrineLen: (eng.get('DEFAULT_TRAINING') || '').length });
        }
        if (req.method === 'POST' && req.url === '/generate') {
            const input = JSON.parse((await readBody(req)) || '{}');
            const out = await generateDraft(input);
            return json(res, 200, out);
        }
        if (req.method === 'POST' && req.url === '/analyze') {
            // The post-message analysis pass (runAnalysis) is wired in a follow-up;
            // the draft pipeline is the parity-first milestone.
            return json(res, 501, { ok: false, error: 'analyze endpoint not yet wired' });
        }
        return json(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
        return json(res, 500, { ok: false, error: e.message });
    }
});

if (require.main === module) {
    // Warm the VM once at boot so the first request isn't slow.
    try { loadEngine(); } catch (e) { console.error('engine warmup failed:', e.message); process.exit(1); }

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use — the engine is probably already running.`);
            console.error(`Stop it first:  lsof -ti tcp:${PORT} | xargs kill   (or set ENGINE_PORT to another port)`);
            process.exit(1);
        }
        throw e;
    });

    server.listen(PORT, HOST, () => console.log(`SSAI engine listening on http://${HOST}:${PORT}`));
}

module.exports = { server };
