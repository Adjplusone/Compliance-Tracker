'use strict';
const { test, assert, equal } = require('./run');
const { parseDate, evaluateStaff, evaluateRequirement } = require('../src/rules/compliance');
const { STATUS, REQUIREMENTS, TRACK } = require('../src/config');

const TODAY = new Date(Date.UTC(2026, 10, 9)); // 2026-11-09
const req = (key) => REQUIREMENTS.find((r) => r.key === key);
const rec = (values, evidence) => ({ staffId: 'x', name: 'Test Staff', values: values || {}, evidence: evidence || {} });
const file = (name, valid = true) => ({ name, size: 200000, valid, reason: valid ? null : 'file is empty (0 bytes)' });

// --- date parsing -----------------------------------------------------------
test('parseDate accepts ISO dates', () => {
  equal(parseDate('2026-11-09').toISOString().slice(0, 10), '2026-11-09');
});
test('parseDate rejects null, empty and malformed values', () => {
  for (const v of [null, undefined, '', '  ', 'not a date', '09-Nov-2026', '2026/11/09', 2026]) {
    equal(parseDate(v), null, `should reject ${JSON.stringify(v)}`);
  }
});
test('parseDate rejects impossible calendar dates', () => {
  equal(parseDate('2026-02-31'), null);
  equal(parseDate('2026-13-01'), null);
});

// --- the compliance-scanner NaN bug ----------------------------------------
test('REGRESSION: a missing date never vanishes from the report', () => {
  // The precedent skill used `new Date(value || '')` -> Invalid Date -> NaN,
  // so every comparison was false and the staff member landed in NEITHER
  // compliant NOR issues. Every item must always carry a definite status.
  const r = evaluateStaff(rec({}, {}), TODAY);
  equal(r.items.length, REQUIREMENTS.length, 'every requirement must be evaluated');
  for (const item of r.items) {
    assert(Object.values(STATUS).includes(item.status), `${item.key} has no valid status`);
    assert(item.daysUntil === null || Number.isFinite(item.daysUntil), `${item.key} daysUntil is NaN`);
  }
  equal(r.score, 0);
  equal(r.followUpRequired, true);
});

// --- Track B: renewal -------------------------------------------------------
test('Track B: future expiry beyond 90 days is Compliant', () => {
  const r = evaluateRequirement(req('wwcc'), rec({ WWCC_Expiry: { value: '2030-03-04' } }, { wwcc: [file('WWCC.pdf')] }), TODAY);
  equal(r.status, STATUS.COMPLIANT);
  equal(r.daysUntil, 1211);
});
test('Track B: expiry within 90 days is Expiring Soon', () => {
  const r = evaluateRequirement(req('wwcc'), rec({ WWCC_Expiry: { value: '2027-01-15' } }, { wwcc: [file('WWCC.pdf')] }), TODAY);
  equal(r.status, STATUS.EXPIRING);
  equal(r.daysUntil, 67);
});
test('Track B: past expiry is Expired with a positive day count', () => {
  const r = evaluateRequirement(req('wwcc'), rec({ WWCC_Expiry: { value: '2025-06-30' } }, { wwcc: [file('WWCC.pdf')] }), TODAY);
  equal(r.status, STATUS.EXPIRED);
  equal(r.daysUntil, -497);
  assert(/Expired 497 days ago/.test(r.reason));
});
test('Track B: evidence but no expiry is Requires Review, not Compliant', () => {
  // This is the 27-of-80 NDIS_WC_Expiry case.
  const r = evaluateRequirement(req('ndis_worker_check'),
    rec({ NDIS_WC_Expiry: { value: null } }, { ndis_worker_check: [file('NDIS_Worker_Check.png')] }), TODAY);
  equal(r.status, STATUS.REVIEW);
  assert(/renewal cannot be monitored/i.test(r.reason));
});

// --- Track A: one-time ------------------------------------------------------
test('Track A: date plus a real file is Compliant, with no invented expiry', () => {
  const r = evaluateRequirement(req('police_check'),
    rec({ Police_Check_Issue_Date: { value: '2025-04-10' } }, { police: [file('Police_Check.pdf')] }), TODAY);
  equal(r.status, STATUS.COMPLIANT);
  equal(r.daysUntil, null, 'a one-time item must not carry a countdown');
  equal(r.reason, null);
});
test('Track A: an old issue date never expires', () => {
  const r = evaluateRequirement(req('police_check'),
    rec({ Police_Check_Issue_Date: { value: '2015-01-01' } }, { police: [file('Police_Check.pdf')] }), TODAY);
  equal(r.status, STATUS.COMPLIANT, 'one-time items have no renewal cycle');
});
test('Track A: date recorded but no document is Requires Review', () => {
  const r = evaluateRequirement(req('infection_control'),
    rec({ Infection_Control_Completion_date: { value: '2026-10-31' } }, {}), TODAY);
  equal(r.status, STATUS.REVIEW);
  assert(/no supporting document/i.test(r.reason));
});
test('Track A: document on file but no date is Requires Review', () => {
  const r = evaluateRequirement(req('ndis_orientation'),
    rec({ Date_Issued: { value: null } }, { orientation: [file('NDIS_Worker_Orientation.pdf')] }), TODAY);
  equal(r.status, STATUS.REVIEW);
  assert(/date not recorded/i.test(r.reason));
});
test('no requirement invents an expiry for a one-time item', () => {
  const oneTime = REQUIREMENTS.filter((r) => r.track === TRACK.ONE_TIME).map((r) => r.key);
  equal(oneTime.sort().join(','), 'infection_control,ndis_orientation,police_check');
});

// --- legitimacy -------------------------------------------------------------
test('a file failing verification yields Requires Review, never Compliant', () => {
  const r = evaluateRequirement(req('police_check'),
    rec({ Police_Check_Issue_Date: { value: '2025-04-10' } }, { police: [file('Police_Check.pdf', false)] }), TODAY);
  equal(r.status, STATUS.REVIEW);
  assert(/failed verification/i.test(r.reason));
});

// --- nothing at all ---------------------------------------------------------
test('no date and no evidence is Missing', () => {
  const r = evaluateRequirement(req('cpr'), rec({}, {}), TODAY);
  equal(r.status, STATUS.MISSING);
});

// --- scoring ----------------------------------------------------------------
test('score reports numerator and denominator, not a bare percentage', () => {
  const r = evaluateStaff(rec({ WWCC_Expiry: { value: '2030-03-04' } }, { wwcc: [file('WWCC.pdf')] }), TODAY);
  equal(r.scoreNumerator, 1);
  equal(r.scoreDenominator, 10);
  equal(r.score, 10);
});
test('excluded items leave the denominator', () => {
  const r = evaluateStaff(rec({ WWCC_Expiry: { value: '2030-03-04' } }, { wwcc: [file('WWCC.pdf')] }), TODAY,
    { excludeKeys: ['vehicle_registration', 'vehicle_insurance'] });
  equal(r.scoreDenominator, 8);
  equal(r.score, 13);
});
test('expiry alerts are ordered most urgent first and bucketed', () => {
  const r = evaluateStaff(rec({
    WWCC_Expiry: { value: '2027-01-15' },          // 67 days -> bucket 90
    Drivers_License_Expiry: { value: '2026-11-20' }, // 11 days -> bucket 30
    Renewal_Date: { value: '2025-06-30' },           // expired
  }, {
    wwcc: [file('WWCC.pdf')], drivers_licence: [file('DL.pdf')], first_aid: [file('FA.pdf')],
  }), TODAY);
  equal(r.expiryAlerts.map((a) => a.key).join(','), 'first_aid,drivers_licence,wwcc');
  equal(r.expiryAlerts[1].bucket, 30);
  equal(r.expiryAlerts[2].bucket, 90);
});
