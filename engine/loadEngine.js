'use strict';
/**
 * Loads the REAL legacy SSAI JS into a Node vm context and bridges its
 * browser-style top-level `let`/`const`/`function` symbols out so the host can
 * run the unmodified `generate()` / `runAnalysis()`.
 *
 * Why concatenate: the legacy globals (sb, api, sessions, activeId, models,
 * respCount, currentSender, globalTraining) are top-level `let`s in
 * supabase-client.js, shared browser-style across <script> tags. Node's vm does
 * NOT share top-level lexical bindings across separate runInContext calls, so we
 * emulate the browser by running all files in ONE script scope, then append an
 * epilogue (same scope) that exposes a `set/get/generate/runAnalysis` bridge via
 * a direct `eval` over the shared scope.
 *
 * api.js is intentionally EXCLUDED — the host injects headless callApi/callMistral
 * (server-held keys, no DOM cost-logging). Everything else is byte-identical legacy.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const LEGACY_JS = path.join(__dirname, '..', 'legacy', 'js');

// Browser load order, minus api.js (host injects callApi/callMistral).
const FILES = ['config.js', 'doctrine.js', 'supabase-client.js', 'ui.js', 'app.js', 'onlyfans.js'];

const noop = () => {};

/** A forgiving DOM element stub: string value props are real strings; method-ish
 *  props are no-ops; unknown reads fall back to a chainable no-op. */
function makeEl() {
    const el = {
        style: {}, dataset: {}, value: '', innerHTML: '', textContent: '', title: '',
        className: '', id: '', disabled: false, checked: false, scrollTop: 0, scrollHeight: 0,
        offsetHeight: 0, clientHeight: 0, children: [], parentNode: null, files: [],
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        appendChild: noop, removeChild: noop, remove: noop, replaceChildren: noop,
        addEventListener: noop, removeEventListener: noop, setAttribute: noop,
        removeAttribute: noop, getAttribute: () => null, insertAdjacentHTML: noop,
        focus: noop, blur: noop, click: noop, select: noop, setSelectionRange: noop,
        scrollIntoView: noop, closest: () => null, matches: () => false,
        querySelector: () => makeEl(), querySelectorAll: () => [], getContext: () => null,
    };
    return el;
}

function makeDocument() {
    const cache = {};
    const doc = {
        _cache: cache,
        title: '',
        readyState: 'complete',
        documentElement: { style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } },
        body: makeEl(),
        getElementById(id) {
            if (!cache[id]) cache[id] = makeEl();
            return cache[id];
        },
        querySelector: () => makeEl(),
        querySelectorAll: () => [],
        createElement: () => makeEl(),
        createTextNode: () => makeEl(),
        addEventListener: noop,
        removeEventListener: noop,
    };
    return doc;
}

/** Supabase-compatible write-capture client. Reads return empty; writes are
 *  recorded so the host can persist them. Chainable + thenable to match the JS SDK. */
function makeSbCapture(writes) {
    const builder = (table) => {
        const ctx = { table, op: null, payload: null, filters: [] };
        const chain = {
            insert(p) { ctx.op = 'insert'; ctx.payload = p; writes.push({ ...ctx }); return chain; },
            update(p) { ctx.op = 'update'; ctx.payload = p; return chain; },
            upsert(p, o) { ctx.op = 'upsert'; ctx.payload = p; ctx.onConflict = o; writes.push({ ...ctx }); return chain; },
            delete() { ctx.op = 'delete'; return chain; },
            select() { return chain; },
            eq(c, v) { ctx.filters.push(['eq', c, v]); if (ctx.op === 'update' || ctx.op === 'delete') writes.push({ ...ctx }); return chain; },
            neq() { return chain; }, gte() { return chain; }, lte() { return chain; },
            order() { return chain; }, limit() { return chain; }, range() { return chain; },
            single() { return Promise.resolve({ data: null, error: null }); },
            maybeSingle() { return Promise.resolve({ data: null, error: null }); },
            then(onF, onR) { return Promise.resolve({ data: null, error: null }).then(onF, onR); },
            catch(onR) { return Promise.resolve({ data: null, error: null }).catch(onR); },
        };
        return chain;
    };
    return { from: builder, _writes: writes };
}

function buildSandbox() {
    const document = makeDocument();
    const sandbox = {
        console,
        setTimeout: (fn) => { return 0; }, // fire-and-forget timers never run (matches harness)
        clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
        queueMicrotask: (fn) => Promise.resolve().then(fn),
        document,
        localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
        navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'node' },
        location: { href: 'http://engine.local', origin: 'http://engine.local', hostname: 'engine.local' },
        fetch: (...a) => globalThis.fetch(...a),
        alert: noop, confirm: () => true, prompt: () => null,
        performance: { now: () => Date.now() },
        crypto: {
            getRandomValues: (a) => crypto.randomFillSync(a),
            subtle: { digest: async (_alg, buf) => crypto.createHash('sha256').update(Buffer.from(buf)).digest().buffer },
        },
        // getOrCreateSb() is never called at top level; provide a stub anyway.
        supabase: { createClient: () => makeSbCapture([]) },
        TextEncoder, TextDecoder,
        Date, Math, JSON, RegExp, String, Number, Boolean, Array, Object, Symbol, Map, Set,
        Promise, parseFloat, parseInt, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
        Intl, Error, TypeError,
    };
    sandbox.addEventListener = noop;
    sandbox.removeEventListener = noop;
    sandbox.dispatchEvent = noop;
    sandbox.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
    sandbox.requestAnimationFrame = (fn) => 0;
    sandbox.cancelAnimationFrame = noop;
    sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    return { sandbox, document };
}

// The legacy bundle is read from disk and compiled ONCE (the expensive part);
// each engine instance then just runs that precompiled script into a fresh VM
// context (cheap). This keeps per-request setup light while giving every
// generation its own isolated globals — see createEngine().
let compiledScript = null;

function compileBundle() {
    if (compiledScript) return compiledScript;

    let source = '';
    for (const f of FILES) {
        source += `\n/* ==== legacy/js/${f} ==== */\n` + fs.readFileSync(path.join(LEGACY_JS, f), 'utf8') + '\n';
    }
    // Epilogue (same scope) — bridge the browser-shared lexical bindings out.
    source += `
/* ==== engine bridge epilogue ==== */
globalThis.__SSAI_ENGINE = {
  set: function (name, value) { eval(name + ' = value'); },
  get: function (name) { try { return eval(name); } catch (e) { return undefined; } },
  generate: function () { return generate(); },
  runAnalysis: function (sessionId, msgs, model, lastResponse, profile) { return runAnalysis(sessionId, msgs, model, lastResponse, profile); },
};
`;

    compiledScript = new vm.Script(source, { filename: 'ssai-legacy-bundle.js' });
    return compiledScript;
}

/**
 * Build a FRESH, isolated engine instance: its own VM context with its own copy
 * of every legacy global (models / sessions / activeId / callApi / the DOM
 * stubs). Concurrent generations each call this, so one run can never clobber
 * another's state mid-flight. The compiled bundle is shared and reused, so this
 * only pays the (small) cost of running the top-level legacy code into a new
 * context — no disk re-read, no re-compile.
 */
function createEngine() {
    const script = compileBundle();
    const { sandbox, document } = buildSandbox();
    vm.createContext(sandbox);
    script.runInContext(sandbox);

    const eng = sandbox.__SSAI_ENGINE;
    if (!eng) throw new Error('Engine bridge failed to initialize (top-level throw before epilogue).');

    return { eng, sandbox, document, makeSbCapture };
}

let cached = null;

/**
 * Cached, shared engine instance for READ-ONLY use (health/doctrine probes,
 * parity checks, boot warmup). Do NOT use this for generate() — mutating its
 * globals is not concurrency-safe. Generations must use createEngine().
 */
function loadEngine() {
    if (cached) return cached;
    cached = createEngine();
    return cached;
}

module.exports = { loadEngine, createEngine, makeSbCapture };
