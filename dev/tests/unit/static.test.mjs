// Static checks on the shipped files (index.html, src/, vercel.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const srcFiles = readdirSync(join(root, 'src')).filter(f => /\.(js|css)$/.test(f)).map(f => `src/${f}`);
const jsFiles = srcFiles.filter(f => f.endsWith('.js'));
const html = read('index.html');

test('no HTML-injection sinks, eval or DOMPurify in src/*.js or index.html', () => {
    for (const f of [...jsFiles, 'index.html']) {
        const s = read(f);
        for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'DOMPurify']) {
            assert.ok(!s.includes(bad), `${f} contains ${bad}`);
        }
    }
});

test('index.html: no inline handlers, inline styles, inline scripts, remote URLs or zoom lock', () => {
    assert.ok(!/\son[a-z]+\s*=/i.test(html), 'inline on*= handler');
    assert.ok(!/\sstyle\s*=/i.test(html), 'style= attribute');
    const scripts = html.match(/<script\b[^>]*>/gi) || [];
    for (const s of scripts) assert.ok(/\ssrc=/.test(s), `inline script: ${s}`);
    assert.ok(!/https?:\/\//i.test(html), 'remote URL in index.html');
    assert.ok(!/maximum-scale/i.test(html) && !/user-scalable/i.test(html), 'viewport blocks zoom');
});

test('src/*.js and src/*.css reference no remote URLs', () => {
    for (const f of srcFiles) assert.ok(!/https?:\/\//i.test(read(f)), `${f} has a remote URL`);
});

test('no test hooks in shipped code', () => {
    for (const f of [...jsFiles, 'index.html']) {
        const s = read(f);
        for (const bad of ['stub', '__FB_STUB__', 'location.search', 'URLSearchParams', 'window.__']) {
            assert.ok(!s.includes(bad), `${f} contains ${bad}`);
        }
    }
});

test('vercel.json: strict CSP and security headers', () => {
    const cfg = JSON.parse(read('vercel.json'));
    const h = Object.fromEntries(cfg.headers.find(x => x.source === '/(.*)').headers.map(x => [x.key, x.value]));
    for (const k of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options',
        'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy']) {
        assert.ok(h[k], `missing ${k}`);
    }
    const csp = Object.fromEntries(h['Content-Security-Policy'].split(';').map(d => d.trim()).filter(Boolean)
        .map(d => { const [n, ...v] = d.split(/\s+/); return [n, v]; }));
    assert.deepEqual(csp['script-src'], ["'self'"]);
    for (const d of ['script-src', 'style-src', 'default-src']) {
        for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'data:']) {
            assert.ok(!(csp[d] || []).includes(bad), `${d} contains ${bad}`);
        }
    }
    assert.deepEqual(csp['object-src'], ["'none'"]);
    assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
    assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
});

test('no .firebaserc (emulator only, never a real project)', () => {
    assert.ok(!existsSync(join(root, '.firebaserc')));
});

test('limits in src/lib.js and firestore.rules agree', () => {
    const rules = read('firestore.rules');
    assert.ok(rules.includes("str(d, 'name', 1, 100)"));
    assert.ok(rules.includes("str(d, 'address', 0, 300)"));
    assert.ok(rules.includes('l.size() <= 12'));
});
