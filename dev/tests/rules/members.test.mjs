// Firestore rules tests. Run with the emulator (needs Java 21):
//   npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
    doc, setDoc, getDoc, getDocs, collection, addDoc, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { validateMember, NOTICE_VERSION } from '../../../src/lib.js';

const MEMBERS = 'artifacts/sma-registry-2026/public/data/members';
let env;

const ANON = { firebase: { sign_in_provider: 'anonymous' } };
const PASSWORD = (email) => ({ email, firebase: { sign_in_provider: 'password' } });

const unauth = () => env.unauthenticatedContext().firestore();
const anon = (uid = 'anon-1') => env.authenticatedContext(uid, ANON).firestore();
const emailUser = () => env.authenticatedContext('helper-1', PASSWORD('helper@test.invalid')).firestore();
const admin = () => env.authenticatedContext('admin-1', PASSWORD('admin@test.invalid')).firestore();
const anonWithAdminDoc = () => env.authenticatedContext('anon-admin', ANON).firestore();

// Exactly what src/app.js sends for a new registration.
function newShape(overrides = {}) {
    const { clean } = validateMember({
        name: 'Jane Citizen', email: 'jane@example.com', mobile: '0412 345 678', profession: 'Nurse',
        address: '1 Main St', spouse: '', spouseProfession: '',
        household: [{ type: 'Child', name: 'Sam', ageCategory: 'Minor' }, { type: 'Parent', name: 'Mum', ageCategory: 'Adult' }]
    });
    return {
        ...clean, isVerifiedPaid: false, paymentDeclared: true, consentGiven: true,
        consentNoticeVersion: NOTICE_VERSION, consentAt: serverTimestamp(), submittedAt: serverTimestamp(),
        ...overrides
    };
}

// What the site wrote before this change.
function legacyShape(overrides = {}) {
    return {
        name: 'Old Member', email: 'old@example.com', mobile: '0412345678', profession: '', address: '',
        spouse: '', spouseProfession: '', householdMembers: [], childrenList: [],
        isVerifiedPaid: false, submittedAt: '2026-03-01T10:00:00.000Z', ...overrides
    };
}

const hm = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ type: 'Child', name: 'Child ' + i, ageCategory: 'Minor', ...extra }));

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-shema-registry',
        firestore: { rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8') }
    });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'admins/admin-1'), { name: 'Test admin' });
        await setDoc(doc(db, 'admins/anon-admin'), { name: 'Anonymous with admin doc' });
        await setDoc(doc(db, `${MEMBERS}/seed-new`), { ...newShape({ consentAt: new Date(), submittedAt: new Date() }) });
        await setDoc(doc(db, `${MEMBERS}/seed-legacy`), legacyShape({ name: 'x'.repeat(150), oddField: 'kept from old data' }));
    });
});

// ---------- create ----------
test('1. valid new-shape document from the real client code: allowed (unauthenticated)', async () => {
    await assertSucceeds(addDoc(collection(unauth(), MEMBERS), newShape()));
});
test('2. valid new-shape document as an anonymous user: allowed', async () => {
    await assertSucceeds(addDoc(collection(anon(), MEMBERS), newShape()));
});
test('3. isVerifiedPaid true on create: denied', async () => {
    await assertFails(addDoc(collection(unauth(), MEMBERS), newShape({ isVerifiedPaid: true })));
});
test('4. consent false or consent fields missing: denied', async () => {
    await assertFails(addDoc(collection(unauth(), MEMBERS), newShape({ consentGiven: false })));
    const d = newShape(); delete d.consentGiven; delete d.consentNoticeVersion; delete d.consentAt;
    await assertFails(addDoc(collection(unauth(), MEMBERS), d));
});
test('5. client-chosen submittedAt (past Date, or string) on the new shape: denied', async () => {
    await assertFails(addDoc(collection(unauth(), MEMBERS), newShape({ submittedAt: new Date('2020-01-01') })));
    await assertFails(addDoc(collection(unauth(), MEMBERS), newShape({ submittedAt: '2020-01-01T00:00:00Z' })));
});
test('6. extra field (role: admin): denied', async () => {
    await assertFails(addDoc(collection(unauth(), MEMBERS), newShape({ role: 'admin' })));
});
test('7. bad profile fields: denied', async () => {
    for (const o of [{ name: '' }, { name: 'x'.repeat(101) }, { email: 'no-at-sign' }, { mobile: '04abc12345' }, { address: 'x'.repeat(301) }]) {
        await assertFails(addDoc(collection(unauth(), MEMBERS), newShape(o)), JSON.stringify(o).slice(0, 40));
    }
});
test('8. bad household lists: denied', async () => {
    const bad = [
        hm(13),
        [{ type: 'Admin', name: 'X', ageCategory: 'Minor' }],
        [{ type: 'Child', name: 'X', ageCategory: 'Minor', extra: 1 }],
        [{ type: 'Child', name: 42, ageCategory: 'Minor' }],
        [{ type: 'Parent', name: 'Mum', ageCategory: 'Minor' }],
        [{ type: 'Child', name: '<img src=x onerror=alert(1)>'.repeat(5), ageCategory: 'Minor' }]
    ];
    for (const list of bad) {
        await assertFails(addDoc(collection(unauth(), MEMBERS), newShape({ householdMembers: list })));
    }
});
test('9. 12 valid household entries: allowed', async () => {
    await assertSucceeds(addDoc(collection(unauth(), MEMBERS), newShape({ householdMembers: hm(12) })));
});
test('9b. worst case within limits (12 household, 12 children, every field at maximum length): allowed', async () => {
    const big = hm(12).map((h, i) => ({ ...h, name: String(i).padEnd(100, 'x') }));
    await assertSucceeds(addDoc(collection(unauth(), MEMBERS), newShape({
        name: 'n'.repeat(100), email: 'e'.repeat(240) + '@example.com', mobile: '+' + '1'.repeat(15),
        profession: 'p'.repeat(100), address: 'a'.repeat(300), spouse: 's'.repeat(100), spouseProfession: 'q'.repeat(100),
        householdMembers: big, childrenList: big.map(h => h.name)
    })));
    // Same worst case through the LEGACY branch (evaluated after the new-shape check fails).
    await assertSucceeds(addDoc(collection(unauth(), MEMBERS), legacyShape({ householdMembers: big, childrenList: big.map(h => h.name) })));
});
test('10. legacy shape allowed; legacy with isVerifiedPaid true denied', async () => {
    await assertSucceeds(addDoc(collection(unauth(), MEMBERS), legacyShape()));
    await assertFails(addDoc(collection(unauth(), MEMBERS), legacyShape({ isVerifiedPaid: true })));
});
test('11. create anywhere else: denied', async () => {
    await assertFails(setDoc(doc(unauth(), 'artifacts/other/public/data/members/x'), newShape()));
    await assertFails(setDoc(doc(anon(), 'admins/anon-1'), { name: 'me' }));
    await assertFails(setDoc(doc(unauth(), 'anything/x'), { a: 1 }));
});

// ---------- read ----------
test('12. read: only listed administrators', async () => {
    for (const db of [unauth(), anon(), emailUser()]) {
        await assertFails(getDoc(doc(db, `${MEMBERS}/seed-new`)));
        await assertFails(getDocs(collection(db, MEMBERS)));
    }
    await assertSucceeds(getDoc(doc(admin(), `${MEMBERS}/seed-new`)));
    await assertSucceeds(getDocs(collection(admin(), MEMBERS)));
});
test('13. anonymous user whose UID has an admins document: denied', async () => {
    await assertFails(getDocs(collection(anonWithAdminDoc(), MEMBERS)));
});

// ---------- update / delete ----------
test('14. non-admins cannot update or delete', async () => {
    for (const db of [unauth(), anon(), emailUser()]) {
        await assertFails(updateDoc(doc(db, `${MEMBERS}/seed-new`), { isVerifiedPaid: true }));
        await assertFails(deleteDoc(doc(db, `${MEMBERS}/seed-new`)));
    }
});
test('15. admin toggles paid, with or without updatedAt', async () => {
    await assertSucceeds(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { isVerifiedPaid: true, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { isVerifiedPaid: false }));
    await assertFails(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { isVerifiedPaid: 'yes' }));
});
test('16. admin toggles paid on a messy legacy record: allowed', async () => {
    await assertSucceeds(updateDoc(doc(admin(), `${MEMBERS}/seed-legacy`), { isVerifiedPaid: true, updatedAt: serverTimestamp() }));
});
test('17. admin profile edit rules', async () => {
    const { clean } = validateMember({ name: 'Jane Edited', email: 'jane@example.com', mobile: '0412345678', household: [] });
    await assertSucceeds(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { ...clean, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { ...clean, name: 'x'.repeat(101), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { submittedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { consentGiven: false }));
    await assertFails(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { ...clean, role: 'admin' }));
    await assertFails(updateDoc(doc(admin(), `${MEMBERS}/seed-new`), { ...clean, updatedAt: new Date('2020-01-01') }));
});
test('18. admin delete: allowed', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), `${MEMBERS}/seed-new`)));
});

// ---------- admins collection ----------
test('19. admins collection: own entry readable, nothing else, no writes', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'admins/admin-1')));
    await assertSucceeds(getDoc(doc(emailUser(), 'admins/helper-1'))); // reading own (missing) entry is allowed
    await assertFails(getDoc(doc(emailUser(), 'admins/admin-1')));
    await assertFails(getDocs(collection(admin(), 'admins')));
    await assertFails(setDoc(doc(admin(), 'admins/new-person'), { name: 'x' }));
    await assertFails(setDoc(doc(emailUser(), 'admins/helper-1'), { name: 'x' }));
    await assertFails(deleteDoc(doc(admin(), 'admins/admin-1')));
});
