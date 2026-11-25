// Accessibility checks: axe-core (WCAG 2.0/2.1 A and AA), 44px targets at phone width,
// keyboard journey, dialogs and zoom. Pre-existing colour-contrast issues are written to
// a report file for the committee rather than failing the test; contrast problems in
// anything this change added DO fail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { launch, openApp, login, repoRoot } from './helpers.mjs';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const NEW_UI = ['#privacy-card', '.field-error', '#error-summary', '#view-privacy', '#scan-result', '.admin-tool-btn',
    '.required-note', '.consent-label', '.privacy-link', '#login-error'];

let browser;
const contrastReport = [];
before(async () => { browser = await launch(); });
after(async () => {
    await browser?.close();
    const dir = join(repoRoot, 'dev', 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'existing-contrast-issues.json'), JSON.stringify(contrastReport, null, 2));
});

async function axe(page, label) {
    await page.evaluate(axeSource);
    const res = await page.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target.join(' '), html: n.html.slice(0, 160) })) }));
    });
    const other = res.filter(v => v.id !== 'color-contrast');
    const contrast = res.find(v => v.id === 'color-contrast');
    if (contrast) {
        const newOnes = [];
        for (const n of contrast.nodes) {
            const inNew = await page.evaluate(({ sel, list }) => {
                const el = document.querySelector(sel);
                return !!el && list.some(s => el.closest(s));
            }, { sel: contrast.nodes.length ? n.target : '', list: NEW_UI });
            (inNew ? newOnes : contrastReport).push({ state: label, ...n });
        }
        assert.deepEqual(newOnes, [], `${label}: contrast failures in elements added by this change`);
    }
    assert.deepEqual(other, [], `${label}: axe violations`);
}

test('axe: every state of the app', async () => {
    const app = await openApp(browser, {
        contextOptions: { bypassCSP: true, reducedMotion: 'reduce' },
        state: { members: { m1: { name: 'Jane', email: 'j@example.com', mobile: '0412345678', householdMembers: [{ type: 'Child', name: 'Sam', ageCategory: 'Minor' }], isVerifiedPaid: false, submittedAt: '2026-01-01T00:00:00Z' } } }
    });
    const { page } = app;
    try {
        await page.click('[data-action="add-member"]');
        await axe(page, 'form');
        await page.click('#submit-btn');
        await axe(page, 'form with errors');
        await page.click('#privacy-card [data-action="show-privacy"]');
        await axe(page, 'privacy');
        await page.click('[data-action="show-login"]');
        await axe(page, 'login');
        await login(page);
        await page.waitForSelector('[data-action="edit"]');
        await page.click('[data-action="scan-records"]');
        await axe(page, 'admin');
        await page.click('[data-action="delete"]');
        await axe(page, 'delete dialog');
        await page.keyboard.press('Escape');
        await page.click('[data-action="edit"]');
        await page.click('#submit-btn');
        await axe(page, 'confirm dialog');
    } finally { await app.close(); }
});

test('targets are at least 44 x 44 px at 390 px width; zoom is allowed', async () => {
    const app = await openApp(browser, { contextOptions: { viewport: { width: 390, height: 844 } } });
    const { page } = app;
    try {
        await page.click('[data-action="add-member"]');
        const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input[type="checkbox"], a[href]')]
            .filter(e => e.offsetParent !== null)
            .map(e => ({ e: e.id || e.className.toString().slice(0, 40) || e.tagName, r: e.getBoundingClientRect() }))
            .filter(x => x.r.width < 44 || x.r.height < 44)
            .map(x => `${x.e} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`));
        assert.deepEqual(small, []);
        const vp = await page.getAttribute('meta[name="viewport"]', 'content');
        assert.ok(!/maximum-scale|user-scalable/.test(vp), vp);
    } finally { await app.close(); }
});

test('keyboard: errors get focus and are announced; dialogs return focus', async () => {
    const app = await openApp(browser);
    const { page } = app;
    try {
        // Empty submit by keyboard.
        await page.focus('#submit-btn');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'f-name', 'focus on first invalid field');
        const desc = await page.evaluate(() => {
            const el = document.activeElement;
            return { invalid: el.getAttribute('aria-invalid'), text: document.getElementById(el.getAttribute('aria-describedby')).textContent.trim() };
        });
        assert.deepEqual(desc, { invalid: 'true', text: 'Enter your full name.' });
        assert.match(await page.textContent('#error-summary-text'), /Please fix 4 problems below\./);

        // Typing clears the error for that field.
        await page.keyboard.type('Jane Citizen');
        assert.equal(await page.getAttribute('#f-name', 'aria-invalid'), null);

        // Fill the rest by keyboard and open the confirm dialog.
        await page.fill('#f-mobile', '0412345678');
        await page.fill('#f-email', 'jane@example.com');
        await page.focus('#f-consent');
        await page.keyboard.press('Space');
        await page.focus('#submit-btn');
        await page.keyboard.press('Enter');
        assert.ok(await page.evaluate(() => document.getElementById('confirm-submit-modal').open));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'confirm-submit-btn');
        await page.keyboard.press('Escape');
        assert.ok(!(await page.evaluate(() => document.getElementById('confirm-submit-modal').open)));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'submit-btn', 'focus returns to the opener');

        // Household row: add focuses name; remove moves focus sensibly.
        await page.focus('#add-member-btn');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.activeElement.name), 'h_name');
        const labels = await page.evaluate(() => {
            const row = document.querySelector('.member-row');
            const lab = (id) => document.querySelector(`label[for="${id}"]`)?.textContent;
            const [t, n, a] = row.querySelectorAll('select, input');
            return [row.getAttribute('aria-label'), lab(t.id), lab(n.id), lab(a.id), row.querySelector('.remove-row').getAttribute('aria-label')];
        });
        assert.deepEqual(labels, ['Household member 1', 'Relationship', 'Full name', 'Age group', 'Remove household member 1']);
        await page.focus('.remove-row');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'add-member-btn');

        // Every form control has a label.
        const unlabelled = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
            .filter(e => !(e.labels && e.labels.length)).map(e => e.id || e.name));
        assert.deepEqual(unlabelled, []);

        // Autocomplete tokens.
        const ac = await page.evaluate(() => Object.fromEntries(['f-name', 'f-mobile', 'f-email', 'f-profession', 'f-address', 'f-spouse', 'admin-email', 'admin-pw']
            .map(id => [id, document.getElementById(id).getAttribute('autocomplete')])));
        assert.deepEqual(ac, { 'f-name': 'name', 'f-mobile': 'tel', 'f-email': 'email', 'f-profession': 'organization-title', 'f-address': 'street-address', 'f-spouse': 'off', 'admin-email': 'username', 'admin-pw': 'current-password' });
        assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
});
