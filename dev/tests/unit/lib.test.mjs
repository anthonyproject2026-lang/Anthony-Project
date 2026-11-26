import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LIMITS, MESSAGES, asText, normaliseMobile, validateMember, csvCell, buildCsv, toMillis, findSuspicious
} from '../../../src/lib.js';

const valid = () => ({
    name: '  Jane Citizen ', email: ' Jane@Example.COM ', mobile: '0412 345 678',
    profession: 'Nurse', address: '1 Main St, Shepparton VIC 3630', spouse: '', spouseProfession: '',
    household: [{ type: 'Child', name: 'Sam', ageCategory: 'Minor' }]
});

test('asText only passes strings and finite numbers', () => {
    assert.equal(asText('a<b>'), 'a<b>');
    assert.equal(asText(5), '5');
    assert.equal(asText(NaN), '');
    assert.equal(asText(null), '');
    assert.equal(asText(undefined), '');
    assert.equal(asText({ toString: () => '<x>' }), '');
    assert.equal(asText(['<x>']), '');
});

test('normaliseMobile strips spaces, brackets, dashes and dots', () => {
    assert.equal(normaliseMobile(' (04) 12-345.678 '), '0412345678');
    assert.equal(normaliseMobile('+61 412 345 678'), '+61412345678');
});

test('validateMember accepts and cleans a valid record', () => {
    const r = validateMember(valid());
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.clean.name, 'Jane Citizen');
    assert.equal(r.clean.email, 'jane@example.com');
    assert.equal(r.clean.mobile, '0412345678');
    assert.deepEqual(r.clean.householdMembers, [{ type: 'Child', name: 'Sam', ageCategory: 'Minor' }]);
    assert.deepEqual(r.clean.childrenList, ['Sam']);
    assert.deepEqual(Object.keys(r.clean).sort(), ['address', 'childrenList', 'email', 'householdMembers', 'mobile', 'name', 'profession', 'spouse', 'spouseProfession']);
});

test('validateMember reports each error with the agreed message', () => {
    const cases = [
        [{ name: '' }, 'name', MESSAGES.name],
        [{ name: 'x'.repeat(101) }, 'name', MESSAGES.tooLong100],
        [{ email: 'no-at-sign' }, 'email', MESSAGES.email],
        [{ email: 'a@b' }, 'email', MESSAGES.email],
        [{ mobile: '04abc' }, 'mobile', MESSAGES.mobile],
        [{ mobile: '1234567' }, 'mobile', MESSAGES.mobile],
        [{ profession: 'x'.repeat(101) }, 'profession', MESSAGES.tooLong100],
        [{ address: 'x'.repeat(301) }, 'address', MESSAGES.tooLong300],
        [{ spouse: 'x'.repeat(101) }, 'spouse', MESSAGES.tooLong100],
        [{ spouseProfession: 'x'.repeat(101) }, 'spouseProfession', MESSAGES.tooLong100]
    ];
    for (const [patch, key, msg] of cases) {
        const r = validateMember({ ...valid(), ...patch });
        assert.equal(r.ok, false, key);
        assert.equal(r.errors[key], msg, key);
    }
});

test('validateMember household rules', () => {
    const r = validateMember({
        ...valid(), household: [
            { type: 'Parent', name: 'Mum', ageCategory: 'Minor' },
            { type: 'Admin', name: 'X', ageCategory: 'Old' },
            { type: 'Child', name: '   ', ageCategory: 'Minor' }
        ]
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.clean.householdMembers, [
        { type: 'Parent', name: 'Mum', ageCategory: 'Adult' },
        { type: 'Child', name: 'X', ageCategory: 'Minor' }
    ]);
    const long = validateMember({ ...valid(), household: [{ type: 'Child', name: 'x'.repeat(101), ageCategory: 'Minor' }] });
    assert.equal(long.errors['household-0'], MESSAGES.householdName);
    const many = validateMember({ ...valid(), household: Array.from({ length: 13 }, (_, i) => ({ type: 'Child', name: 'C' + i, ageCategory: 'Minor' })) });
    assert.equal(many.errors.household, MESSAGES.householdMax);
    const twelve = validateMember({ ...valid(), household: Array.from({ length: LIMITS.householdMax }, (_, i) => ({ type: 'Other', name: 'C' + i, ageCategory: 'Adult' })) });
    assert.equal(twelve.ok, true);
});

test('csvCell quotes and neutralises spreadsheet formulas', () => {
    assert.equal(csvCell('plain'), '"plain"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('=1+1'), `"'=1+1"`);
    assert.equal(csvCell('+61412345678'), `"'+61412345678"`);
    assert.equal(csvCell('-1'), `"'-1"`);
    assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
    assert.equal(csvCell('  =cmd'), `"'  =cmd"`);
    assert.equal(csvCell('\tx'), `"'\tx"`);
    assert.equal(csvCell('\rx'), `"'\rx"`);
    assert.equal(csvCell(undefined), '""');
    assert.equal(csvCell({}), '""');
});

function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') q = false;
            else cell += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
        else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows;
}

test('buildCsv: BOM, CRLF, header, awkward values round-trip', () => {
    const csv = buildCsv([{
        name: 'Smith, "Jo"\nJr', mobile: '0412345678', email: 'a@b.au', profession: undefined,
        address: 'x', spouse: 'y', spouseProfession: 'z',
        householdMembers: [{ type: 'Child', name: '=HYPERLINK("x")', ageCategory: 'Minor' }], isVerifiedPaid: true
    }, { name: 'B', isVerifiedPaid: 'yes' }]);
    assert.ok(csv.startsWith('\uFEFF'));
    const rows = parseCsv(csv.slice(1));
    assert.deepEqual(rows[0], ['Name', 'Mobile', 'Email', 'Profession', 'Address', 'Spouse', 'Spouse Profession', 'Household', 'Paid']);
    assert.equal(rows[1][0], 'Smith, "Jo"\nJr');
    assert.equal(rows[1][3], '');
    assert.equal(rows[1][7], 'Child:=HYPERLINK("x")(Minor)');
    assert.equal(rows[1][8], 'true');
    assert.equal(rows[2][8], 'false');
    assert.equal(rows.length, 3);
});

test('toMillis handles Timestamps, {seconds}, ISO strings and junk', () => {
    assert.equal(toMillis({ toMillis: () => 42 }), 42);
    assert.equal(toMillis({ seconds: 2 }), 2000);
    assert.equal(toMillis('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'));
    assert.equal(toMillis('not a date'), 0);
    assert.equal(toMillis(undefined), 0);
});

test('findSuspicious: clean record is not listed', () => {
    assert.deepEqual(findSuspicious([{ id: 'a', name: 'Jane', email: 'j@x.au', mobile: '+61412345678', householdMembers: [{ type: 'Child', name: 'Sam', ageCategory: 'Minor' }], childrenList: ['Sam'], isVerifiedPaid: false, submittedAt: 'x' }]), []);
});

test('findSuspicious: each reason', () => {
    const [r] = findSuspicious([{
        id: 'b', name: '<img src=x onerror=alert(1)>', email: 'javascript:alert(1)', mobile: '=1+1',
        profession: '&lt;b&gt;', address: 'x'.repeat(601), spouse: 42,
        householdMembers: [{ type: 'Admin', name: 'ok', ageCategory: 'Old' }, 'str'],
        childrenList: 'no', isVerifiedPaid: 'false);alert(1);(', role: 'admin'
    }]);
    const got = r.findings.map(f => `${f.field}:${f.reason}`);
    for (const want of [
        'name:html-tag', 'name:event-handler', 'email:script-url', 'mobile:spreadsheet-formula',
        'profession:html-entity', 'address:too-long', 'spouse:wrong-type',
        'householdMembers[0].type:unexpected-value', 'householdMembers[0].ageCategory:unexpected-value',
        'householdMembers[1]:wrong-type', 'childrenList:wrong-type', 'isVerifiedPaid:wrong-type', 'role:unexpected-field'
    ]) assert.ok(got.includes(want), `missing ${want}; got ${got.join(', ')}`);
    assert.equal(r.id, 'b');
});

test('findSuspicious: householdMembers not an array', () => {
    const [r] = findSuspicious([{ id: 'c', householdMembers: { a: 1 } }]);
    assert.deepEqual(r.findings, [{ field: 'householdMembers', reason: 'wrong-type' }]);
});
