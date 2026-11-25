// SHEMA membership registry — browser code.
// Security rules for this file (checked by dev/tests/unit/static.test.mjs):
//   * never use an HTML-string DOM API (the banned list is in static.test.mjs);
//     all stored data reaches the page through textContent or input.value;
//   * no inline event handlers and nothing attached to window;
//   * no test switches: tests replace vendor/firebase.bundle.js at the network layer.
import {
    initializeApp, getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
    onSnapshot, serverTimestamp, getAuth, signInAnonymously, signInWithEmailAndPassword, signOut
} from '../vendor/firebase.bundle.js';
import {
    LIMITS, HOUSEHOLD_TYPES, AGE_CATEGORIES, NOTICE_VERSION, MESSAGES,
    asText, validateMember, buildCsv, toMillis, findSuspicious
} from './lib.js';

const firebaseConfig = {
    apiKey: "AIzaSyBK0XSL0_TZJjepQv87os2ikJ7Nx_smX3c",
    authDomain: "anthony-form.firebaseapp.com",
    projectId: "anthony-form",
    storageBucket: "anthony-form.firebasestorage.app",
    messagingSenderId: "803510657296",
    appId: "1:803510657296:web:2f16dd93ede50c3312c595",
    measurementId: "G-VTKZW577HP"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const APP_ID = 'sma-registry-2026';
const MEMBERSHIP_FEE = 50;
const SITE_TITLE = 'Shepparton Malayalee Association Registry';

let members = [];
let isAdmin = false;
let deleteId = null;
let unsubscribeMembers = null;

const membersCol = () => collection(db, 'artifacts', APP_ID, 'public', 'data', 'members');
const memberRef = (id) => doc(db, 'artifacts', APP_ID, 'public', 'data', 'members', id);

// ---------- DOM helpers (text only) ----------
function el(tag, opts = {}, children = []) {
    const node = document.createElement(tag);
    if (opts.class) node.className = opts.class;
    if (opts.text !== undefined) node.textContent = asText(opts.text);
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, asText(v));
    if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = asText(v);
    for (const c of children) if (c) node.append(c);
    return node;
}

function icon(classes) {
    return el('i', { class: classes, attrs: { 'aria-hidden': 'true' } });
}

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Views, announcements ----------
function showView(viewId) {
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    const target = $(`view-${viewId}`);
    target.classList.remove('hidden');
    target.classList.add('view-transition');
    document.title = `${target.dataset.title || 'Registry'} – ${SITE_TITLE}`;
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    const heading = target.querySelector('.view-heading');
    if (heading) heading.focus({ preventScroll: true });
}

function announce(msg, success = true) {
    const region = $(success ? 'sr-status' : 'sr-alert');
    region.textContent = '';
    setTimeout(() => { region.textContent = asText(msg); }, 50);
}

function showToast(msg, success = true) {
    const t = $('toast');
    t.className = `fixed bottom-10 left-1/2 -translate-x-1/2 px-6 py-4 rounded-2xl shadow-2xl z-[5000] transition-all duration-500 flex items-center gap-3 whitespace-nowrap ${success ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`;
    t.replaceChildren(
        icon(`fa-solid ${success ? 'fa-check-circle text-emerald-400' : 'fa-circle-xmark'}`),
        el('span', { class: 'text-sm font-bold', text: msg })
    );
    t.classList.remove('hidden');
    announce(msg, success);
    setTimeout(() => t.classList.add('toast-active'), 10);
    setTimeout(() => {
        t.classList.remove('toast-active');
        setTimeout(() => t.classList.add('hidden'), 500);
    }, 3000);
}

// ---------- Auth ----------
async function startAnonymousSession() {
    try {
        await signInAnonymously(auth);
    } catch (error) {
        console.error('Anonymous sign-in failed:', error && error.code);
    }
}

async function initAuth() {
    try {
        await auth.authStateReady();
        // Administrators log in on each visit (suits shared family devices).
        if (auth.currentUser && !auth.currentUser.isAnonymous) await signOut(auth);
        if (!auth.currentUser) await startAnonymousSession();
    } catch (error) {
        console.error('Auth start-up error:', error && error.code);
    }
}

function startMembersListener() {
    if (unsubscribeMembers) unsubscribeMembers();
    unsubscribeMembers = onSnapshot(membersCol(), (snapshot) => {
        members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        members.sort((a, b) => toMillis(b.submittedAt) - toMillis(a.submittedAt));
        if (isAdmin) renderAdminContent();
    }, (error) => {
        console.error('Firestore error:', error && error.code);
        if (isAdmin) {
            showToast('You no longer have access to the registry.', false);
            logout();
        }
    });
}

function setLoginError(msg) {
    const p = $('login-error');
    p.replaceChildren(icon('fa-solid fa-circle-exclamation'), document.createTextNode(' ' + msg));
    p.hidden = false;
}

async function handleLogin(e) {
    e.preventDefault();
    $('login-error').hidden = true;
    const email = $('admin-email').value.trim();
    const pw = $('admin-pw').value;
    let user;
    try {
        user = (await signInWithEmailAndPassword(auth, email, pw)).user;
    } catch (err) {
        setLoginError('Incorrect email or password.');
        announce('Incorrect email or password.', false);
        return;
    }
    let allowed = false;
    try {
        allowed = (await getDoc(doc(db, 'admins', user.uid))).exists();
    } catch (err) {
        allowed = false;
    }
    $('admin-pw').value = '';
    if (!allowed) {
        try { await signOut(auth); } catch (_) { /* ignore */ }
        await startAnonymousSession();
        setLoginError('This account is not authorised to manage the registry.');
        announce('This account is not authorised to manage the registry.', false);
        return;
    }
    isAdmin = true;
    startMembersListener();
    showView('admin');
    renderAdminContent();
    showToast('Logged in successfully');
}

async function logout() {
    if (unsubscribeMembers) { unsubscribeMembers(); unsubscribeMembers = null; }
    isAdmin = false;
    members = [];
    $('admin-member-list').replaceChildren();
    $('scan-result').replaceChildren();
    $('scan-result').hidden = true;
    $('stat-total').textContent = '0';
    $('stat-paid').textContent = '0';
    $('stat-revenue').textContent = '$0';
    resetForm();
    try { await signOut(auth); } catch (_) { /* ignore */ }
    await startAnonymousSession();
    showView('form');
}

// ---------- Household rows ----------
function renumberRows() {
    const rows = $('household-container').querySelectorAll('.member-row');
    rows.forEach((row, i) => {
        const n = i + 1;
        row.setAttribute('aria-label', `Household member ${n}`);
        row.querySelector('.remove-row').setAttribute('aria-label', `Remove household member ${n}`);
    });
}

function srLabel(forId, text) {
    return el('label', { class: 'sr-only', text, attrs: { for: forId } });
}

let rowCounter = 0;

function addMemberRow(type = 'Child', name = '', age = 'Minor', { focus = false } = {}) {
    const container = $('household-container');
    if (container.querySelectorAll('.member-row').length >= LIMITS.householdMax) {
        showToast(MESSAGES.householdMax, false);
        return null;
    }
    const safeType = HOUSEHOLD_TYPES.includes(type) ? type : 'Child';
    const isParent = safeType === 'Parent';
    const safeAge = isParent ? 'Adult' : (AGE_CATEGORIES.includes(age) ? age : 'Minor');
    const id = ++rowCounter;

    const typeSelect = el('select', {
        class: 'h-type w-24 px-3 py-3 bg-white border-none rounded-xl text-[10px] font-black uppercase text-slate-700 outline-none',
        attrs: { name: 'h_type', id: `h-type-${id}` }
    }, HOUSEHOLD_TYPES.map(t => el('option', { text: t, attrs: { value: t } })));
    typeSelect.value = safeType;

    const nameInput = el('input', {
        class: 'h-name flex-1 px-4 py-3 bg-white border-none rounded-xl text-xs font-bold text-slate-700 outline-none',
        attrs: { type: 'text', name: 'h_name', id: `h-name-${id}`, placeholder: 'Full Name', autocomplete: 'off', maxlength: String(LIMITS.householdName) }
    });
    nameInput.value = asText(name);

    const ageSelect = el('select', {
        class: 'w-full px-3 py-3 bg-white border-none rounded-xl text-[10px] font-black uppercase text-slate-700 outline-none',
        attrs: { name: 'h_age', id: `h-age-${id}` }
    }, [
        el('option', { text: 'Minor (<18)', attrs: { value: 'Minor' } }),
        el('option', { text: 'Adult (18+)', attrs: { value: 'Adult' } })
    ]);
    ageSelect.value = safeAge;

    const ageContainer = el('div', { class: isParent ? 'age-select-container hidden flex-1 md:w-32' : 'age-select-container flex-1 md:w-32' },
        [srLabel(`h-age-${id}`, 'Age group'), ageSelect]);

    const removeBtn = el('button', {
        class: 'remove-row w-11 h-11 flex items-center justify-center bg-white/50 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors',
        attrs: { type: 'button' }
    }, [icon('fa-solid fa-times')]);

    const row = el('div', {
        class: 'member-row flex flex-col md:flex-row gap-2 items-start md:items-center mb-4 bg-white/20 p-3 rounded-2xl border border-white/30',
        attrs: { role: 'group' }
    }, [
        el('div', { class: 'flex gap-2 w-full md:w-auto flex-1' }, [
            srLabel(`h-type-${id}`, 'Relationship'), typeSelect,
            srLabel(`h-name-${id}`, 'Full name'), nameInput
        ]),
        el('div', { class: 'flex gap-2 w-full md:w-auto items-center' }, [ageContainer, removeBtn]),
        el('p', { class: 'field-error w-full', attrs: { id: `err-h-${id}`, hidden: '' } })
    ]);
    container.append(row);
    renumberRows();
    if (focus) nameInput.focus();
    return row;
}

function onHouseholdChange(e) {
    const select = e.target.closest('select.h-type');
    if (!select) return;
    const ageContainer = select.closest('.member-row').querySelector('.age-select-container');
    if (select.value === 'Parent') {
        ageContainer.classList.add('hidden');
        ageContainer.querySelector('select').value = 'Adult';
    } else {
        ageContainer.classList.remove('hidden');
    }
}

function onHouseholdClick(e) {
    const btn = e.target.closest('button.remove-row');
    if (!btn) return;
    const row = btn.closest('.member-row');
    const next = row.nextElementSibling;
    row.remove();
    renumberRows();
    if (next) next.querySelector('.h-name').focus();
    else $('add-member-btn').focus();
}

// ---------- Form validation and submit ----------
const FIELD_INPUTS = {
    name: 'f-name', email: 'f-email', mobile: 'f-mobile', profession: 'f-profession',
    address: 'f-address', spouse: 'f-spouse', spouseProfession: 'f-spouse-profession', consent: 'f-consent'
};

function setFieldError(input, errEl, msg) {
    if (msg) {
        errEl.replaceChildren(icon('fa-solid fa-circle-exclamation'), document.createTextNode(' ' + msg));
        errEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errEl.id);
    } else {
        errEl.replaceChildren();
        errEl.hidden = true;
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
    }
}

function isEditMode() {
    return Boolean($('form-member-id').value);
}

function readForm() {
    const f = $('registry-form');
    const rows = [...$('household-container').querySelectorAll('.member-row')];
    return {
        raw: {
            name: f.elements.name.value,
            email: f.elements.email.value,
            mobile: f.elements.mobile.value,
            profession: f.elements.profession.value,
            address: f.elements.address.value,
            spouse: f.elements.spouse.value,
            spouseProfession: f.elements.spouseProfession.value,
            household: rows.map(r => ({
                type: r.querySelector('select[name="h_type"]').value,
                name: r.querySelector('input[name="h_name"]').value,
                ageCategory: r.querySelector('select[name="h_age"]').value
            }))
        },
        rows,
        paymentDeclared: $('confirmPayment').checked,
        consent: $('f-consent').checked
    };
}

function showErrors(errors, rows) {
    const invalid = [];
    for (const [key, inputId] of Object.entries(FIELD_INPUTS)) {
        const input = $(inputId);
        const msg = errors[key];
        setFieldError(input, $(`err-${key}`), msg);
        if (msg) invalid.push(input);
    }
    rows.forEach((row, i) => {
        const input = row.querySelector('.h-name');
        const msg = errors[`household-${i}`];
        setFieldError(input, row.querySelector('.field-error'), msg);
        if (msg) invalid.push(input);
    });
    const hh = $('err-household');
    if (errors.household) {
        hh.replaceChildren(icon('fa-solid fa-circle-exclamation'), document.createTextNode(' ' + errors.household));
        hh.hidden = false;
    } else {
        hh.hidden = true;
    }
    const count = Object.keys(errors).length;
    const summary = $('error-summary');
    if (count) {
        $('error-summary-text').textContent = `Please fix ${count} problem${count === 1 ? '' : 's'} below.`;
        summary.hidden = false;
        invalid.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        (invalid[0] || summary).focus();
    } else {
        summary.hidden = true;
    }
}

function validateCurrentForm() {
    const state = readForm();
    const result = validateMember(state.raw);
    if (!isEditMode() && !state.consent) {
        result.errors.consent = MESSAGES.consent;
        result.ok = false;
    }
    return { state, result };
}

function handleSubmitConfirm(e) {
    e.preventDefault();
    const { state, result } = validateCurrentForm();
    showErrors(result.errors, state.rows);
    if (!result.ok) {
        announce($('error-summary-text').textContent, false);
        return;
    }
    $('confirm-submit-modal').showModal();
    $('confirm-submit-btn').focus();
}

let submitOriginalNodes = null;

function setSubmitBusy(busy) {
    const btn = $('submit-btn');
    if (busy) {
        submitOriginalNodes = [...btn.childNodes];
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.replaceChildren(el('div', { class: 'loader mx-auto' }), el('span', { class: 'sr-only', text: 'Saving' }));
    } else {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        if (submitOriginalNodes) btn.replaceChildren(...submitOriginalNodes);
        $('submit-label').textContent = isEditMode() ? 'Update Profile' : 'Submit Registration';
    }
}

function resetForm() {
    $('registry-form').reset();
    $('household-container').replaceChildren();
    $('form-member-id').value = '';
    $('privacy-card').hidden = false;
    $('submit-label').textContent = 'Submit Registration';
    showErrors({}, []);
}

async function handleFinalSubmit() {
    $('confirm-submit-modal').close();
    const { state, result } = validateCurrentForm();
    if (!result.ok) { showErrors(result.errors, state.rows); return; }
    const memberId = $('form-member-id').value;
    const wasEdit = Boolean(memberId);

    setSubmitBusy(true);
    try {
        if (wasEdit) {
            // Admin edit: profile fields only. Paid status, submission date and consent are kept.
            await updateDoc(memberRef(memberId), { ...result.clean, updatedAt: serverTimestamp() });
        } else {
            if (!auth.currentUser) await startAnonymousSession();
            await addDoc(membersCol(), {
                ...result.clean,
                isVerifiedPaid: false,
                paymentDeclared: state.paymentDeclared === true,
                consentGiven: true,
                consentNoticeVersion: NOTICE_VERSION,
                consentAt: serverTimestamp(),
                submittedAt: serverTimestamp()
            });
        }
        setSubmitBusy(false);
        resetForm();
        if (wasEdit) {
            showView('admin');
            showToast('Profile updated');
        } else {
            showView('success');
        }
    } catch (err) {
        setSubmitBusy(false);
        showToast('We could not save your registration. Please check your connection and try again.', false);
    }
}

// ---------- Admin ----------
function memberCard(m) {
    const paid = m.isVerifiedPaid === true;
    const name = asText(m.name);
    const household = Array.isArray(m.householdMembers) ? m.householdMembers : [];
    const spouse = asText(m.spouse);
    const spouseProfession = asText(m.spouseProfession);

    const payBtn = el('button', {
        class: paid
            ? 'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
            : 'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all bg-amber-400 text-white shadow-lg shadow-amber-500/20',
        text: paid ? 'Verified' : 'Pending Verification',
        attrs: {
            type: 'button',
            'aria-label': `Payment for ${name}: ${paid ? 'verified. Activate to mark as pending.' : 'pending verification. Activate to mark as verified.'}`
        },
        dataset: { action: 'toggle-paid', id: m.id, paid: paid ? 'true' : 'false' }
    });

    const nameBlock = el('div', {}, [
        el('h3', { class: 'text-xl font-black text-white leading-tight', text: name }),
        el('p', { class: 'text-[10px] text-emerald-300 font-extrabold uppercase tracking-[0.15em] mt-1', text: asText(m.profession) || 'Association Member' }),
        m.paymentDeclared === true ? el('p', { class: 'text-[10px] text-white/70 font-bold', text: 'Member says transfer made' }) : null
    ]);

    const infoRow = (iconCls, valueEl, rowCls, boxCls) => el('div', { class: rowCls }, [
        el('div', { class: boxCls }, [icon(`fa-solid ${iconCls} text-[10px] text-emerald-300`)]),
        valueEl
    ]);
    const box = 'w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center';

    const details = el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold text-white/70 border-y border-white/10 py-6' }, [
        infoRow('fa-phone', el('span', { class: 'text-white font-bold', text: asText(m.mobile) }), 'flex items-center gap-3', box),
        infoRow('fa-envelope', el('span', { class: 'text-white font-bold truncate', text: asText(m.email) }), 'flex items-center gap-3', box),
        infoRow('fa-map-marker-alt', el('span', { class: 'text-white/80 leading-relaxed pt-1', text: asText(m.address) || 'No Address Provided' }),
            'flex items-start gap-3 col-span-1 md:col-span-2', 'w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0')
    ]);

    let family = null;
    if (spouse || household.length) {
        const parts = [];
        if (spouse) {
            parts.push(el('div', { class: 'flex items-center gap-3' }, [
                icon('fa-solid fa-heart text-rose-400 text-xs'),
                el('span', { class: 'text-xs font-bold text-white', text: spouse }),
                spouseProfession ? el('span', { class: 'text-[10px] text-white/50 font-medium italic', text: `(${spouseProfession})` }) : null
            ]));
        }
        if (household.length) {
            parts.push(el('div', { class: 'flex flex-wrap gap-2' }, [
                icon('fa-solid fa-people-roof text-emerald-400 text-xs mt-1 mr-1'),
                ...household.map(c => {
                    const h = c && typeof c === 'object' ? c : {};
                    return el('span', { class: 'px-3 py-1 bg-white/10 text-white rounded-lg text-[10px] font-extrabold border border-white/10 flex items-center gap-2 shadow-sm' }, [
                        el('span', { class: 'opacity-50 uppercase text-[8px] font-black', text: asText(h.type) }),
                        document.createTextNode(asText(h.name)),
                        el('span', { class: 'w-1 h-1 bg-white/30 rounded-full', attrs: { 'aria-hidden': 'true' } }),
                        el('span', { class: 'text-emerald-300', text: h.ageCategory === 'Adult' ? '18+' : 'Un18' })
                    ]);
                })
            ]));
        }
        family = el('div', { class: 'space-y-4 bg-white/5 p-5 rounded-2xl border border-white/10' }, parts);
    }

    const actions = el('div', { class: 'grid grid-cols-2 gap-4 pt-2' }, [
        el('button', {
            class: 'py-4 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-lg',
            text: 'Edit Profile', attrs: { type: 'button', 'aria-label': `Edit profile of ${name}` }, dataset: { action: 'edit', id: m.id }
        }),
        el('button', {
            class: 'py-4 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 transition-all shadow-lg',
            text: 'Remove', attrs: { type: 'button', 'aria-label': `Remove ${name}` }, dataset: { action: 'delete', id: m.id }
        })
    ]);

    return el('div', { class: 'premium-card !p-8 flex flex-col gap-6' }, [
        el('div', { class: 'flex justify-between items-start' }, [
            el('div', { class: 'flex gap-5' }, [nameBlock]),
            payBtn
        ]),
        details,
        family,
        actions
    ]);
}

function renderAdminContent() {
    const searchTerm = ($('admin-search').value || '').toLowerCase();
    const filtered = members.filter(m =>
        asText(m.name).toLowerCase().includes(searchTerm) ||
        asText(m.mobile).includes(searchTerm) ||
        asText(m.spouse).toLowerCase().includes(searchTerm)
    );
    const paidCount = members.filter(m => m.isVerifiedPaid === true).length;
    $('stat-total').textContent = String(members.length);
    $('stat-paid').textContent = String(paidCount);
    $('stat-revenue').textContent = `$${paidCount * MEMBERSHIP_FEE}`;

    const list = $('admin-member-list');
    if (!filtered.length) {
        list.replaceChildren(el('div', { class: 'text-center py-24 text-white/40 font-bold uppercase tracking-widest', text: 'No matching records' }));
        return;
    }
    list.replaceChildren(...filtered.map(memberCard));
}

async function togglePaid(id, current) {
    try {
        await updateDoc(memberRef(id), { isVerifiedPaid: !current, updatedAt: serverTimestamp() });
        showToast('Payment status updated');
    } catch (err) {
        showToast('Action restricted', false);
    }
}

function editMember(id) {
    const m = members.find(x => x.id === id);
    if (!m) return;
    const f = $('registry-form');
    showErrors({}, []);
    $('form-member-id').value = m.id;
    f.elements.name.value = asText(m.name);
    f.elements.email.value = asText(m.email);
    f.elements.mobile.value = asText(m.mobile);
    f.elements.profession.value = asText(m.profession);
    f.elements.address.value = asText(m.address);
    f.elements.spouse.value = asText(m.spouse);
    f.elements.spouseProfession.value = asText(m.spouseProfession);

    $('household-container').replaceChildren();
    if (Array.isArray(m.householdMembers)) {
        m.householdMembers.slice(0, LIMITS.householdMax).forEach(hm => {
            const h = hm && typeof hm === 'object' ? hm : {};
            addMemberRow(h.type, h.name, h.ageCategory);
        });
    }
    $('privacy-card').hidden = true;
    $('submit-label').textContent = 'Update Profile';
    showView('form');
}

function confirmDelete(id) {
    deleteId = id;
    $('delete-modal').showModal();
    $('cancel-delete-btn').focus();
}

async function executeDelete() {
    if (!deleteId) return;
    try {
        await deleteDoc(memberRef(deleteId));
        $('delete-modal').close();
        deleteId = null;
        showToast('Member removed', false);
    } catch (err) {
        showToast('Admin access required', false);
    }
}

function exportData() {
    if (!isAdmin) {
        showToast('Admin access required to export', false);
        return;
    }
    const blob = new Blob([buildCsv(members)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { attrs: { href: url, download: 'SMA_Registry_2026.csv' } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function scanRecords() {
    if (!isAdmin) return;
    const results = findSuspicious(members);
    const panel = $('scan-result');
    const children = [
        el('h3', { class: 'scan-title', text: 'Check of existing records' }),
        el('p', { text: `Checked ${members.length} records. ${results.length} need review.` })
    ];
    if (results.length) {
        children.push(el('ul', { class: 'scan-list' }, results.map(r => el('li', {}, [
            el('strong', { text: r.name || '(no name)' }),
            document.createTextNode(` — record id ${r.id}: `),
            document.createTextNode(r.findings.map(x => `${x.field} (${x.reason})`).join(', '))
        ]))));
        children.push(el('p', { text: 'Do not copy flagged text into other tools. Tell the web developer which records are listed.' }));
    }
    children.push(el('p', { class: 'scan-note', text: 'This check only reads records. It changes nothing in the database.' }));
    panel.replaceChildren(...children);
    panel.hidden = false;
    announce(`Checked ${members.length} records. ${results.length} need review.`);
}

// ---------- Wiring ----------
const ACTIONS = {
    'show-form': () => showView('form'),
    'show-login': () => {
        if (!isAdmin) { showView('login'); return; }
        if (isEditMode()) resetForm(); // leaving an unsaved edit
        showView('admin');
    },
    'show-privacy': () => showView('privacy'),
    'add-member': () => addMemberRow('Child', '', 'Minor', { focus: true }),
    'export-csv': exportData,
    'scan-records': scanRecords,
    'logout': logout,
    'confirm-submit': handleFinalSubmit,
    'cancel-submit': () => $('confirm-submit-modal').close(),
    'confirm-delete': executeDelete,
    'cancel-delete': () => { deleteId = null; $('delete-modal').close(); },
    'toggle-paid': (btn) => togglePaid(btn.dataset.id, btn.dataset.paid === 'true'),
    'edit': (btn) => editMember(btn.dataset.id),
    'delete': (btn) => confirmDelete(btn.dataset.id)
};

function onDocumentClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const handler = ACTIONS[target.dataset.action];
    if (!handler) return;
    e.preventDefault();
    handler(target);
}

function init() {
    document.addEventListener('click', onDocumentClick);
    $('registry-form').addEventListener('submit', handleSubmitConfirm);
    $('login-form').addEventListener('submit', handleLogin);
    $('admin-search').addEventListener('input', renderAdminContent);
    $('household-container').addEventListener('click', onHouseholdClick);
    $('household-container').addEventListener('change', onHouseholdChange);
    // Clear a field's error as soon as it is corrected.
    $('registry-form').addEventListener('input', (e) => {
        const input = e.target;
        if (input.getAttribute('aria-invalid') === 'true') {
            const err = $(input.getAttribute('aria-describedby'));
            if (err) setFieldError(input, err, '');
        }
    });
    $('f-consent').addEventListener('change', () => {
        if ($('f-consent').checked) setFieldError($('f-consent'), $('err-consent'), '');
    });
    if (location.hash === '#privacy') showView('privacy');
    initAuth();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
