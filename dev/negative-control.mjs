// NEGATIVE CONTROL (not part of npm test). Proves the XSS test can detect the original flaw:
// serves the ORIGINAL site (commit af9f22a) from a git worktree, swaps the gstatic Firebase
// modules for the in-memory stub, seeds the same payload record, logs in and opens
// "Edit Profile". Expected result on the original code: an alert() dialog fires.
//
//   git worktree add ../../shema-registry-baseline af9f22a     (from the repo root)
//   node negative-control.mjs ../../shema-registry-baseline
//
// The original page needs its CDN files (Tailwind, Font Awesome, DOMPurify), so reads from
// cdn.tailwindcss.com and cdnjs.cloudflare.com are allowed here; every Firebase/Google API
// host stays blocked.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, openApp, ADMIN, stubPath } from './tests/browser/helpers.mjs';

const baseline = resolve(process.argv[2] || '../../shema-registry-baseline');
const STUB_URL = 'https://www.gstatic.com/firebasejs/__test_stub__.js';
// The original code imports a few extra names from the SDK; add them to the stub.
const stubSource = readFileSync(stubPath, 'utf8') + `
export const setDoc = async () => {};
export const query = (c) => c;
export const orderBy = () => ({});
export async function signInWithCustomToken() { return signInAnonymously(); }
const __authCbs = new Set();
export function onAuthStateChanged(auth, cb) { __authCbs.add(cb); setTimeout(() => cb(auth.currentUser), 0); return () => __authCbs.delete(cb); }
`;
// Wrap sign-in functions so onAuthStateChanged listeners fire, as the real SDK does.
const wrapped = stubSource
    .replace('export async function signInAnonymously()', 'async function __signInAnonymously()')
    .replace('export async function signInWithEmailAndPassword(', 'async function __signInWithEmailAndPassword(')
    + `
export async function signInAnonymously(...a) { const r = await __signInAnonymously(...a); for (const cb of __authCbs) cb(r.user); return r; }
export async function signInWithEmailAndPassword(...a) { const r = await __signInWithEmailAndPassword(...a); for (const cb of __authCbs) cb(r.user); return r; }
`;

const ALLOWED_CDN = new Set(['cdn.tailwindcss.com', 'cdnjs.cloudflare.com']);

const browser = await launch();
const app = await openApp(browser, {
    root: baseline, csp: false, stub: false,
    state: {
        members: {
            m1: {
                name: 'Payload Record', email: 'p@example.com', mobile: '0412345678',
                householdMembers: [{ type: 'Child', name: '"><img src=x onerror=alert("XSS-fired-in-admin-edit-view")>', ageCategory: 'Minor' }],
                isVerifiedPaid: false, submittedAt: '2026-01-01T00:00:00.000Z'
            }
        }
    },
    extraRoutes: async (route, u) => {
        if (u.href === STUB_URL) { await route.fulfill({ body: wrapped, contentType: 'text/javascript' }); return true; }
        if (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) {
            await route.fulfill({ body: `export * from '${STUB_URL}';`, contentType: 'text/javascript' }); return true;
        }
        if (ALLOWED_CDN.has(u.hostname)) { await route.continue(); return true; }
        return false;
    }
});
const { page } = app;
// The original markup has no data-action attributes: use its own controls.
await page.click('nav button:has-text("Admin Login")');
await page.fill('#admin-email', ADMIN.email);
await page.fill('#admin-pw', ADMIN.password);
await page.click('#view-login button[type="submit"]');
await page.waitForSelector('#admin-member-list button:has-text("Edit Profile")', { timeout: 15000 });
await page.click('#admin-member-list button:has-text("Edit Profile")');
await page.waitForTimeout(1500);
console.log(JSON.stringify({
    baseline,
    dialogsFired: app.dialogs,
    injectedImgElementsInHousehold: await page.$$eval('#household-container img', e => e.length),
    blockedExternalRequests: [...new Set(app.external.map(x => new URL(x).hostname))]
}, null, 2));
await app.close();
await browser.close();
process.exit(app.dialogs.length ? 0 : 1);
