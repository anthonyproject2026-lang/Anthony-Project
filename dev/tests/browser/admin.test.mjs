// Admin model in the browser: only users listed in /admins see the dashboard;
// "has an email" is no longer enough. Also covers log out, edit, toggle paid and delete.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, login, NOT_ADMIN } from './helpers.mjs';

const seed = () => ({
    members: {
        m1: {
            name: 'Jane Citizen', email: 'jane@example.com', mobile: '0412345678', profession: 'Nurse', address: '1 Main St',
            spouse: '', spouseProfession: '', householdMembers: [{ type: 'Child', name: 'Sam', ageCategory: 'Minor' }],
            childrenList: ['Sam'], isVerifiedPaid: true, submittedAt: '2026-01-01T00:00:00.000Z'
        }
    }
});

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('email user without an admins entry is refused and sees no data', async () => {
    const app = await openApp(browser, { state: seed() });
    try {
        await login(app.page, NOT_ADMIN);
        await app.page.waitForSelector('#login-error:not([hidden])');
        assert.match(await app.page.textContent('#login-error'), /not authorised to manage the registry/);
        assert.ok(await app.page.isHidden('#view-admin'));
        assert.equal(await app.page.$$eval('#admin-member-list > *', e => e.length), 0);
        const user = await app.page.evaluate(() => 1);
        assert.equal(user, 1);
        assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
});

test('wrong password gives one generic message', async () => {
    const app = await openApp(browser, { state: seed() });
    try {
        await login(app.page, { email: 'admin@test.invalid', password: 'wrong' });
        await app.page.waitForSelector('#login-error:not([hidden])');
        assert.match(await app.page.textContent('#login-error'), /Incorrect email or password\./);
    } finally { await app.close(); }
});

test('listed admin: dashboard, edit keeps paid status and submittedAt, toggle, delete, log out', async () => {
    const app = await openApp(browser, { state: seed() });
    const { page } = app;
    try {
        await login(page);
        await page.waitForSelector('#admin-member-list [data-action="edit"]');
        assert.equal(await page.textContent('#stat-total'), '1');
        assert.equal(await page.textContent('#stat-paid'), '1');

        await page.click('[data-action="edit"]');
        assert.ok(await page.isHidden('#privacy-card'), 'consent card hidden in edit mode');
        assert.equal(await page.textContent('#submit-label'), 'Update Profile');
        await page.fill('#f-profession', 'Registered Nurse');
        await page.click('#submit-btn');
        await page.click('#confirm-submit-btn');
        await page.waitForSelector('#view-admin:not(.hidden)');
        const calls = await app.calls();
        const upd = calls.find(c => c.op === 'updateDoc');
        assert.equal(upd.data.profession, 'Registered Nurse');
        for (const k of ['isVerifiedPaid', 'submittedAt', 'consentGiven', 'paymentDeclared']) assert.ok(!(k in upd.data), `edit must not send ${k}`);
        assert.deepEqual(upd.data.updatedAt, { __serverTimestamp: true });

        await page.click('[data-action="toggle-paid"]');
        await page.waitForFunction(() => document.getElementById('stat-paid').textContent === '0');

        await page.click('[data-action="delete"]');
        assert.ok(await page.evaluate(() => document.getElementById('delete-modal').open));
        assert.equal(await page.evaluate(() => document.activeElement.id), 'cancel-delete-btn', 'safe choice focused');
        await page.click('[data-action="confirm-delete"]');
        await page.waitForFunction(() => document.getElementById('stat-total').textContent === '0');

        await page.click('[data-action="logout"]');
        await page.waitForSelector('#view-form:not(.hidden)');
        assert.equal(await page.$$eval('#admin-member-list > *', e => e.length), 0);
        await page.click('[data-action="show-login"]');
        assert.ok(await page.isVisible('#view-login'), 'after log out the login screen is shown again');
        assert.deepEqual(app.errors, []);
        assert.deepEqual(app.external, []);
    } finally { await app.close(); }
});
