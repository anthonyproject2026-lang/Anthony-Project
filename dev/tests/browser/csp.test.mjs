// CSP / journey test: the whole public and admin journey runs under the vercel.json
// headers with zero CSP violations, zero console errors and no third-party requests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openApp, login, repoRoot } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('full journey under the production CSP', async () => {
    const app = await openApp(browser, {
        state: { members: { m1: { name: 'Old Record', email: 'o@example.com', mobile: '0412345678', householdMembers: [], isVerifiedPaid: false, submittedAt: '2026-01-01T00:00:00Z' } } }
    });
    const { page, response } = app;
    try {
        // Every header from vercel.json is served (HSTS is skipped on http://127.0.0.1 by design).
        const cfg = JSON.parse(readFileSync(join(repoRoot, 'vercel.json'), 'utf8'));
        const headers = response.headers();
        for (const { key, value } of cfg.headers[0].headers) {
            if (key === 'Strict-Transport-Security') continue;
            assert.equal(headers[key.toLowerCase()], value, key);
        }

        // CSS really loaded from the self-hosted files.
        const css = await page.evaluate(() => {
            const i = document.querySelector('.fa-solid');
            return {
                font: getComputedStyle(document.body).fontFamily,
                hidden: getComputedStyle(document.getElementById('view-success')).display,
                icon: getComputedStyle(i, '::before').content,
                outfitLoaded: [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Outfit' && f.status === 'loaded')
            };
        });
        assert.match(css.font, /Outfit/);
        assert.equal(css.hidden, 'none');
        assert.notEqual(css.icon, 'none');
        assert.ok(css.outfitLoaded, 'Outfit font loaded');

        // Household rows: add, Parent hides age, remove.
        await page.click('[data-action="add-member"]');
        await page.click('[data-action="add-member"]');
        assert.equal(await page.$$eval('.member-row', r => r.length), 2);
        await page.selectOption('.member-row >> nth=0 >> select[name="h_type"]', 'Parent');
        assert.ok(await page.isHidden('.member-row >> nth=0 >> .age-select-container'));
        await page.click('.member-row >> nth=1 >> .remove-row');
        assert.equal(await page.$$eval('.member-row', r => r.length), 1);

        // Empty submit shows errors.
        await page.click('#submit-btn');
        assert.ok(await page.isVisible('#error-summary'));

        // Valid submit.
        await page.fill('#f-name', 'New Member');
        await page.fill('#f-mobile', '0412 345 678');
        await page.fill('#f-email', 'New@Example.com');
        await page.fill('.member-row >> nth=0 >> input[name="h_name"]', 'Parent Name');
        await page.check('#confirmPayment');
        await page.check('#f-consent');
        await page.click('#submit-btn');
        assert.ok(await page.evaluate(() => document.getElementById('confirm-submit-modal').open));
        await page.click('#confirm-submit-btn');
        await page.waitForSelector('#view-success:not(.hidden)');
        const add = (await app.calls()).find(c => c.op === 'addDoc');
        assert.equal(add.path, 'artifacts/sma-registry-2026/public/data/members');
        assert.deepEqual(Object.keys(add.data).sort(), ['address', 'childrenList', 'consentAt', 'consentGiven', 'consentNoticeVersion', 'email',
            'householdMembers', 'isVerifiedPaid', 'mobile', 'name', 'paymentDeclared', 'profession', 'spouse', 'spouseProfession', 'submittedAt']);
        assert.equal(add.data.isVerifiedPaid, false);
        assert.equal(add.data.paymentDeclared, true);
        assert.equal(add.data.consentGiven, true);
        assert.equal(add.data.consentNoticeVersion, 'v1');
        assert.equal(add.data.email, 'new@example.com');
        assert.equal(add.data.mobile, '0412345678');
        assert.deepEqual(add.data.householdMembers, [{ type: 'Parent', name: 'Parent Name', ageCategory: 'Adult' }]);
        assert.deepEqual(add.data.submittedAt, { __serverTimestamp: true });
        assert.ok(!(await page.textContent('#view-success')).includes('securely archived'));

        // Privacy view, login, dashboard, search, toggle, edit, delete dialog, export, log out.
        await page.click('[data-action="show-form"]');
        await page.click('#privacy-card [data-action="show-privacy"]');
        assert.ok(await page.isVisible('#view-privacy'));
        await login(page);
        await page.waitForSelector('#admin-member-list [data-action="edit"]');
        await page.fill('#admin-search', 'new');
        assert.equal(await page.$$eval('#admin-member-list [data-action="edit"]', e => e.length), 1);
        await page.fill('#admin-search', '');
        await page.click('[data-action="toggle-paid"] >> nth=0');
        await page.click('[data-action="edit"] >> nth=0');
        await page.click('[data-action="show-login"]');
        await page.click('[data-action="delete"] >> nth=0');
        await page.keyboard.press('Escape');
        assert.ok(!(await page.evaluate(() => document.getElementById('delete-modal').open)));
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-csv"]')]);
        assert.ok(await download.path());
        await page.click('[data-action="logout"]');
        await page.waitForSelector('#view-form:not(.hidden)');

        assert.deepEqual(await app.cspViolations(), [], 'CSP violations');
        assert.deepEqual(app.errors, [], 'console errors');
        assert.deepEqual(app.external, [], 'third-party requests');
    } finally { await app.close(); }
});
