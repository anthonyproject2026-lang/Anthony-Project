// Shared browser-test harness. Uses playwright-core with the installed Microsoft Edge
// (or Chrome). Every request that is not to 127.0.0.1 is aborted and recorded.
import { chromium } from 'playwright-core';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');
export const stubPath = join(here, '..', 'stubs', 'firebase-stub.js');

export async function launch() {
    for (const channel of ['msedge', 'chrome']) {
        try { return await chromium.launch({ channel, headless: true }); } catch (e) { /* try next */ }
    }
    throw new Error('Neither Microsoft Edge nor Google Chrome could be launched.');
}

export const ADMIN = { email: 'admin@test.invalid', password: 'test-only-password', uid: 'admin-uid-1' };
export const NOT_ADMIN = { email: 'helper@test.invalid', password: 'test-only-password-2', uid: 'helper-uid-2' };

// state: { members, admins, logins } for the stub.
export async function openApp(browser, { csp = true, state = {}, root = repoRoot, stub = true, extraRoutes, contextOptions = {} } = {}) {
    const { server, url } = await startServer({ root, csp, vercelJson: join(repoRoot, 'vercel.json') });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...contextOptions });
    const external = [];
    const requested = [];
    await context.route('**/*', async (route) => {
        const u = new URL(route.request().url());
        requested.push(u.href);
        if (extraRoutes) { const handled = await extraRoutes(route, u); if (handled) return; }
        if (u.hostname !== '127.0.0.1') { external.push(u.href); return route.abort(); }
        if (stub && u.pathname.endsWith('/vendor/firebase.bundle.js')) {
            return route.fulfill({ path: stubPath, contentType: 'text/javascript; charset=utf-8' });
        }
        return route.continue();
    });
    const fullState = {
        members: {}, admins: [ADMIN.uid],
        logins: { [ADMIN.email]: { password: ADMIN.password, uid: ADMIN.uid }, [NOT_ADMIN.email]: { password: NOT_ADMIN.password, uid: NOT_ADMIN.uid } },
        ...state
    };
    await context.addInitScript((s) => {
        window.__FB_STUB__ = s;
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
            window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
        });
    }, fullState);
    const page = await context.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push('console: ' + m.text());
    });
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    const response = await page.goto(url);
    await page.waitForLoadState('networkidle');
    return {
        page, context, url, response, errors, dialogs, external, requested,
        async cspViolations() { return page.evaluate(() => window.__cspViolations); },
        async calls() { return page.evaluate(() => window.__FB_STUB__.calls); },
        async close() { await context.close(); await new Promise(r => server.close(r)); }
    };
}

export async function login(page, who = ADMIN) {
    await page.click('[data-action="show-login"]');
    await page.fill('#admin-email', who.email);
    await page.fill('#admin-pw', who.password);
    await page.click('#login-form button[type="submit"]');
}
