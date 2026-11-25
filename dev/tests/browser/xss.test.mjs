// XSS regression test: stored member data must render as text in the admin views,
// including the admin "Edit Profile" form where the original flaw was.
// Runs twice: with the vercel.json CSP and without it (so the fix does not rely on the CSP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, openApp, login } from './helpers.mjs';

const IMG = '<img src=x onerror=alert(1)>';
const SCRIPT = '<script>alert(1)</script>';
const HOUSEHOLD_NAMES = [
    IMG,
    SCRIPT,
    '"><img src=x onerror=alert(1)>',
    '" autofocus onfocus="alert(1)',
    '<svg onload=alert(1)>',
    '<img src=x onerror="window.__xss=1">',
    '"><script>window.__xss=2</script>'
];
const PAYLOAD_ID = "x'),alert(1),('";

export function payloadState() {
    return {
        members: {
            [PAYLOAD_ID]: {
                name: IMG, profession: IMG, address: IMG, spouse: IMG, spouseProfession: IMG,
                email: IMG, mobile: '=HYPERLINK("http://example.invalid")',
                householdMembers: [
                    ...HOUSEHOLD_NAMES.map(n => ({ type: 'Child', name: n, ageCategory: 'Minor' })),
                    { type: 'Child"><script>alert(1)</script>', name: 'Type payload', ageCategory: 'Minor" onmouseover="alert(1)' }
                ],
                childrenList: HOUSEHOLD_NAMES,
                isVerifiedPaid: 'false);alert(1);(',
                submittedAt: '2026-01-01T00:00:00.000Z'
            }
        }
    };
}

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

for (const csp of [true, false]) {
    test(`stored XSS payloads render as text (CSP ${csp ? 'on' : 'off'})`, async () => {
        const app = await openApp(browser, { csp, state: payloadState() });
        const { page } = app;
        try {
            await login(page);
            await page.waitForSelector('#admin-member-list [data-action="edit"]');

            // Admin card: payloads present as text, no live elements.
            const listText = await page.textContent('#admin-member-list');
            assert.ok(listText.includes(IMG), 'card shows the name as text');
            assert.ok(listText.includes(SCRIPT), 'card shows the script payload as text');

            // Open the edit view (the original sink).
            await page.click('#admin-member-list [data-action="edit"]');
            await page.waitForSelector('#view-form:not(.hidden)');
            await page.waitForTimeout(300);

            const rows = await page.$$eval('#household-container .member-row', els => els.map(r => ({
                name: r.querySelector('input[name="h_name"]').value,
                type: r.querySelector('select[name="h_type"]').value,
                age: r.querySelector('select[name="h_age"]').value
            })));
            assert.deepEqual(rows.slice(0, HOUSEHOLD_NAMES.length).map(r => r.name), HOUSEHOLD_NAMES, 'input values equal payloads exactly');
            const typed = rows[HOUSEHOLD_NAMES.length];
            assert.equal(typed.name, 'Type payload');
            assert.equal(typed.type, 'Child', 'bad type coerced to an allowed value');
            assert.equal(typed.age, 'Minor', 'bad age coerced to an allowed value');
            assert.equal(await page.inputValue('#f-name'), IMG);

            // Scan tool, then export.
            await page.click('[data-action="show-login"]'); // an admin goes straight back to the dashboard
            await page.waitForSelector('[data-action="scan-records"]', { state: 'visible' });
            await page.click('[data-action="scan-records"]');
            const scanText = await page.textContent('#scan-result');
            assert.match(scanText, /Checked 1 records\. 1 need review\./);
            assert.ok(scanText.includes(IMG), 'flagged name shown as text');
            assert.ok(scanText.includes('html-tag'));

            const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-csv"]')]);
            const csv = readFileSync(await download.path(), 'utf8');
            assert.ok(csv.includes(`"'=HYPERLINK(""http://example.invalid"")"`), 'formula cell neutralised and quotes doubled');
            assert.ok(csv.includes(`"${IMG}"`), 'payload cell quoted');

            // Nothing executed, nothing injected.
            const live = await page.evaluate(() => {
                const scope = [document.getElementById('household-container'), document.getElementById('admin-member-list'), document.getElementById('scan-result')];
                let bad = 0;
                for (const s of scope) {
                    bad += s.querySelectorAll('img, script, svg, iframe').length;
                    for (const n of s.querySelectorAll('*')) for (const a of n.attributes) if (/^on/i.test(a.name)) bad++;
                }
                return { bad, xss: window.__xss };
            });
            assert.equal(live.bad, 0, 'no injected elements or handler attributes');
            assert.equal(live.xss, undefined, 'window.__xss never set');
            assert.deepEqual(app.dialogs, [], 'no alert() dialog opened');
            assert.ok(!app.requested.some(u => /\/x$/.test(new URL(u).pathname)), 'no request for the payload image');
            assert.deepEqual(app.errors, []);
            assert.deepEqual(app.external, [], 'no request left 127.0.0.1');
            if (csp) assert.deepEqual(await app.cspViolations(), []);
        } finally {
            await app.close();
        }
    });
}
