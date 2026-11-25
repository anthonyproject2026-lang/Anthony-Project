// Pure helper functions for the SHEMA registry.
// No DOM and no Firebase in this file, so it can be unit-tested in Node.
// Keep LIMITS in step with firestore.rules.

export const LIMITS = Object.freeze({
    name: 100,
    email: 254,
    profession: 100,
    address: 300,
    spouse: 100,
    spouseProfession: 100,
    householdName: 100,
    householdMax: 12
});

export const HOUSEHOLD_TYPES = Object.freeze(['Child', 'Parent', 'Other']);
export const AGE_CATEGORIES = Object.freeze(['Minor', 'Adult']);
export const NOTICE_VERSION = 'v1';

export const MESSAGES = Object.freeze({
    name: 'Enter your full name.',
    tooLong100: 'This is too long. Please use 100 characters or fewer.',
    tooLong300: 'This is too long. Please use 300 characters or fewer.',
    mobile: 'Enter a mobile number using digits only, for example 0412 345 678.',
    email: 'Enter an email address, for example name@example.com.',
    householdName: "Enter this person's full name, or remove the row.",
    householdMax: 'You can list up to 12 household members.',
    consent: 'Please tick the box to confirm you have read the privacy information and agree.'
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MOBILE_RE = /^\+?[0-9]{8,15}$/;

// Any stored value -> a plain string that is safe to give to textContent.
export function asText(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

export function normaliseMobile(s) {
    return asText(s).replace(/[\s().-]/g, '');
}

function trimmed(v) {
    return asText(v).trim();
}

// raw: { name, email, mobile, profession, address, spouse, spouseProfession,
//        household: [{ type, name, ageCategory }] }
// Returns { ok, errors, clean }. errors maps a field key to a message.
// Household errors use the key `household-<index>` (index in the raw list).
export function validateMember(raw = {}) {
    const errors = {};
    const clean = {
        name: trimmed(raw.name),
        email: trimmed(raw.email).toLowerCase(),
        mobile: normaliseMobile(raw.mobile),
        profession: trimmed(raw.profession),
        address: trimmed(raw.address),
        spouse: trimmed(raw.spouse),
        spouseProfession: trimmed(raw.spouseProfession),
        householdMembers: [],
        childrenList: []
    };

    if (!clean.name) errors.name = MESSAGES.name;
    else if (clean.name.length > LIMITS.name) errors.name = MESSAGES.tooLong100;

    if (!clean.email || clean.email.length > LIMITS.email || !EMAIL_RE.test(clean.email)) {
        errors.email = MESSAGES.email;
    }

    if (!MOBILE_RE.test(clean.mobile)) errors.mobile = MESSAGES.mobile;

    for (const key of ['profession', 'spouse', 'spouseProfession']) {
        if (clean[key].length > LIMITS[key]) errors[key] = MESSAGES.tooLong100;
    }
    if (clean.address.length > LIMITS.address) errors.address = MESSAGES.tooLong300;

    const rows = Array.isArray(raw.household) ? raw.household : [];
    rows.forEach((row, i) => {
        const r = row || {};
        const name = trimmed(r.name);
        if (!name) return; // empty rows are dropped
        if (name.length > LIMITS.householdName) {
            errors[`household-${i}`] = MESSAGES.householdName;
            return;
        }
        const type = HOUSEHOLD_TYPES.includes(r.type) ? r.type : 'Child';
        let ageCategory = AGE_CATEGORIES.includes(r.ageCategory) ? r.ageCategory : 'Minor';
        if (type === 'Parent') ageCategory = 'Adult';
        clean.householdMembers.push({ type, name, ageCategory });
    });
    if (clean.householdMembers.length > LIMITS.householdMax) errors.household = MESSAGES.householdMax;

    clean.childrenList = clean.householdMembers.filter(m => m.type === 'Child').map(m => m.name);

    return { ok: Object.keys(errors).length === 0, errors, clean };
}

// One CSV cell, quoted, with spreadsheet-formula protection (OWASP CSV injection).
export function csvCell(v) {
    let s = asText(v);
    if (/^\s*[=+\-@]/.test(s) || s.startsWith('\t') || s.startsWith('\r')) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
}

export const CSV_HEADER = ['Name', 'Mobile', 'Email', 'Profession', 'Address', 'Spouse', 'Spouse Profession', 'Household', 'Paid'];

export function buildCsv(members = []) {
    const lines = [CSV_HEADER.join(',')];
    for (const m of members) {
        const hh = (Array.isArray(m.householdMembers) ? m.householdMembers : [])
            .map(h => `${asText(h && h.type)}:${asText(h && h.name)}(${asText(h && h.ageCategory)})`)
            .join('; ');
        lines.push([
            csvCell(m.name), csvCell(m.mobile), csvCell(m.email), csvCell(m.profession),
            csvCell(m.address), csvCell(m.spouse), csvCell(m.spouseProfession), csvCell(hh),
            m.isVerifiedPaid === true ? 'true' : 'false'
        ].join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
}

// Old records hold ISO strings; new ones hold Firestore Timestamps.
export function toMillis(v) {
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    if (v && typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v === 'string') return Date.parse(v) || 0;
    return 0;
}

const KNOWN_FIELDS = new Set([
    'id', 'name', 'email', 'mobile', 'profession', 'address', 'spouse', 'spouseProfession',
    'householdMembers', 'childrenList', 'isVerifiedPaid', 'paymentDeclared', 'submittedAt',
    'updatedAt', 'consentGiven', 'consentNoticeVersion', 'consentAt'
]);

const FIELD_LIMITS = {
    name: LIMITS.name, email: LIMITS.email, mobile: 20, profession: LIMITS.profession,
    address: LIMITS.address, spouse: LIMITS.spouse, spouseProfession: LIMITS.spouseProfession,
    householdName: LIMITS.householdName, householdType: 10, householdAge: 10, child: LIMITS.householdName
};

function checkString(field, value, limitKey, out, isMobile = false) {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string') { out.push({ field, reason: 'wrong-type' }); return; }
    if (/<\s*[a-zA-Z!\/]/.test(value)) out.push({ field, reason: 'html-tag' });
    if (/\bon[a-z]+\s*=/i.test(value)) out.push({ field, reason: 'event-handler' });
    if (/(javascript|vbscript|data)\s*:/i.test(value)) out.push({ field, reason: 'script-url' });
    if (/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(value)) out.push({ field, reason: 'html-entity' });
    if (/^\s*[=+\-@]/.test(value)) {
        if (!isMobile || !MOBILE_RE.test(normaliseMobile(value))) out.push({ field, reason: 'spreadsheet-formula' });
    }
    if (value.length > 2 * FIELD_LIMITS[limitKey]) out.push({ field, reason: 'too-long' });
}

// Read-only scan of records already in the register. Returns
// [{ id, name, findings: [{ field, reason }] }] for records that need review.
export function findSuspicious(members = []) {
    const results = [];
    for (const m of members) {
        const findings = [];
        if (!m || typeof m !== 'object') continue;
        for (const f of ['name', 'email', 'mobile', 'profession', 'address', 'spouse', 'spouseProfession']) {
            checkString(f, m[f], f, findings, f === 'mobile');
        }
        if (m.householdMembers !== undefined) {
            if (!Array.isArray(m.householdMembers)) {
                findings.push({ field: 'householdMembers', reason: 'wrong-type' });
            } else {
                m.householdMembers.forEach((h, i) => {
                    const base = `householdMembers[${i}]`;
                    if (!h || typeof h !== 'object' || Array.isArray(h)) {
                        findings.push({ field: base, reason: 'wrong-type' });
                        return;
                    }
                    checkString(`${base}.name`, h.name, 'householdName', findings);
                    checkString(`${base}.type`, h.type, 'householdType', findings);
                    checkString(`${base}.ageCategory`, h.ageCategory, 'householdAge', findings);
                    if (typeof h.type === 'string' && !HOUSEHOLD_TYPES.includes(h.type)) {
                        findings.push({ field: `${base}.type`, reason: 'unexpected-value' });
                    }
                    if (typeof h.ageCategory === 'string' && !AGE_CATEGORIES.includes(h.ageCategory)) {
                        findings.push({ field: `${base}.ageCategory`, reason: 'unexpected-value' });
                    }
                });
            }
        }
        if (m.childrenList !== undefined) {
            if (!Array.isArray(m.childrenList)) findings.push({ field: 'childrenList', reason: 'wrong-type' });
            else m.childrenList.forEach((c, i) => checkString(`childrenList[${i}]`, c, 'child', findings));
        }
        if (m.isVerifiedPaid !== undefined && typeof m.isVerifiedPaid !== 'boolean') {
            findings.push({ field: 'isVerifiedPaid', reason: 'wrong-type' });
        }
        for (const k of Object.keys(m)) {
            if (!KNOWN_FIELDS.has(k)) findings.push({ field: k, reason: 'unexpected-field' });
        }
        if (findings.length) results.push({ id: asText(m.id), name: asText(m.name), findings });
    }
    return results;
}
