// Test-only stand-in for vendor/firebase.bundle.js. NEVER deployed (.vercelignore excludes dev/).
// Browser tests swap it in at the network layer with Playwright's page.route().
// State comes from window.__FB_STUB__ = { members: {id: data}, admins: [uid],
//   logins: { email: { password, uid } } } and every write is logged in window.__FB_STUB__.calls.
const S = (window.__FB_STUB__ = window.__FB_STUB__ || {});
S.members = S.members || {};
S.admins = S.admins || [];
S.logins = S.logins || {};
S.calls = S.calls || [];
let nextId = 1;
const listeners = new Set();

const SERVER_TS = Object.freeze({ __serverTimestamp: true });
export const serverTimestamp = () => SERVER_TS;

export const initializeApp = (config) => ({ config });
export const getFirestore = () => ({ kind: 'firestore' });

const clone = (v) => JSON.parse(JSON.stringify(v));
const authState = { currentUser: null };
const isAdmin = () => authState.currentUser && !authState.currentUser.isAnonymous && S.admins.includes(authState.currentUser.uid);

export function getAuth() {
    return {
        get currentUser() { return authState.currentUser; },
        authStateReady: async () => {}
    };
}
export async function signInAnonymously() {
    authState.currentUser = { uid: 'anon-' + (nextId++), isAnonymous: true, email: null };
    return { user: authState.currentUser };
}
export async function signInWithEmailAndPassword(_auth, email, password) {
    const l = S.logins[email];
    if (!l || l.password !== password) { const e = new Error('auth/invalid-credential'); e.code = 'auth/invalid-credential'; throw e; }
    authState.currentUser = { uid: l.uid, isAnonymous: false, email };
    return { user: authState.currentUser };
}
export async function signOut() { authState.currentUser = null; }

export const collection = (_db, ...path) => ({ type: 'collection', path: path.join('/') });
export const doc = (_db, ...path) => ({ type: 'doc', path: path.join('/'), id: path[path.length - 1] });

function permissionError() { const e = new Error('permission-denied'); e.code = 'permission-denied'; return e; }
function notify() {
    for (const l of listeners) l();
}
function snapshot() {
    return { docs: Object.entries(S.members).map(([id, data]) => ({ id, data: () => clone(data) })) };
}

export async function addDoc(col, data) {
    S.calls.push({ op: 'addDoc', path: col.path, data: clone(data) });
    const id = 'new-' + (nextId++);
    S.members[id] = clone(data);
    notify();
    return { id };
}
export async function updateDoc(ref, data) {
    S.calls.push({ op: 'updateDoc', path: ref.path, data: clone(data) });
    if (!isAdmin()) throw permissionError();
    S.members[ref.id] = { ...S.members[ref.id], ...clone(data) };
    notify();
}
export async function deleteDoc(ref) {
    S.calls.push({ op: 'deleteDoc', path: ref.path });
    if (!isAdmin()) throw permissionError();
    delete S.members[ref.id];
    notify();
}
export async function getDoc(ref) {
    S.calls.push({ op: 'getDoc', path: ref.path });
    const [col, id] = ref.path.split('/');
    if (col === 'admins') {
        if (!authState.currentUser || authState.currentUser.uid !== id) throw permissionError();
        return { exists: () => S.admins.includes(id), data: () => ({}) };
    }
    throw permissionError();
}
export function onSnapshot(_col, next, error) {
    if (!isAdmin()) { setTimeout(() => error(permissionError()), 0); return () => {}; }
    const l = () => next(snapshot());
    listeners.add(l);
    setTimeout(l, 0);
    return () => listeners.delete(l);
}
