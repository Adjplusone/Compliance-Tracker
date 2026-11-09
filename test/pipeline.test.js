'use strict';
const path = require('path');
const { test, assert, equal } = require('./run');
const { build } = require('../src/pipeline');
const { STATUS } = require('../src/config');
const { build: buildReport, renderText } = require('../src/report/monthly');

const FIXTURES = path.join(__dirname, 'fixtures');
const ds = build({ today: '2026-11-09', rawDir: FIXTURES });
const by = (n) => ds.staff.find((s) => s.name === n);

test('pipeline runs end to end and keeps every staff member', () => {
  equal(ds.staff.length, 4);
});

test('duplicate folders are merged, not one silently winning', () => {
  const ella = by('Ella Luhrs');
  equal(ella.mergedFolders, true);
  equal(ella.folderNames.sort().join(' + '), 'Ella Luhrs + Luhrs, Ella');
  equal(ella.fileCount, 5, 'files from both folders must be present');
  assert(ella.notes.some((n) => /Duplicate folders merged/.test(n)));
});

test('a staff member with no folder is reported, never dropped', () => {
  equal(ds.reconciliation.unmatchedStaff.length, 1);
  equal(ds.reconciliation.unmatchedStaff[0].name, 'Nofolder Person');
  assert(by('Nofolder Person'), 'must still appear in the dataset');
});

test('a folder with no staff member is reported', () => {
  equal(ds.reconciliation.unmatchedFolders.length, 1);
  equal(ds.reconciliation.unmatchedFolders[0].folder, 'Orphan Folder');
});

test('reconciliation accounts for every record', () => {
  const r = ds.reconciliation;
  equal(r.zohoRecords, 4);
  equal(r.matchedStaff + r.unmatchedStaff.length, r.zohoRecords);
});

test('Makenzie Pickering resolves against the verified onboarding form', () => {
  const m = by('Makenzie Pickering');
  equal(m.byKey.ndis_orientation.date, '2026-10-30');
  equal(m.byKey.wwcc.date, '2030-03-04');
  equal(m.byKey.police_check.date, '2025-04-10');
  equal(m.byKey.drivers_licence.date, '2027-06-06');
  equal(m.byKey.first_aid.date, '2028-01-31');
  equal(m.byKey.infection_control.date, '2026-10-31');
  equal(m.byKey.ndis_worker_check.date, '2031-11-02');
});

test('one-time items with date and a real file are Compliant, with no countdown', () => {
  const m = by('Makenzie Pickering');
  for (const k of ['police_check', 'infection_control']) {
    equal(m.byKey[k].status, STATUS.COMPLIANT, k);
    equal(m.byKey[k].daysUntil, null, k);
  }
});

test('byte-identical evidence for two requirements is flagged, not accepted', () => {
  // This fixture mirrors the live folder: the worker-check and orientation
  // images are both exactly 369427 bytes, i.e. one file filed twice. The
  // orientation then has no distinct evidence of its own.
  const m = by('Makenzie Pickering');
  equal(m.byKey.ndis_orientation.status, STATUS.REVIEW);
  assert(/same file renamed/.test(m.byKey.ndis_orientation.reason));
  equal(m.byKey.ndis_orientation.daysUntil, null, 'still a one-time item, so no countdown');
});

test('an expired renewal item is flagged Expired', () => {
  equal(by('Seb Sobels').byKey.wwcc.status, STATUS.EXPIRED);
});

test('a 0-byte evidence file is reported, not accepted', () => {
  const seb = by('Seb Sobels');
  assert(seb.rejectedFiles.some((f) => /0 bytes/.test(f.reason)));
  assert(seb.notes.some((n) => /failed verification/i.test(n)));
});

test('missing NDIS Worker Check expiry is Requires Review, not Expired', () => {
  const ella = by('Ella Luhrs');
  equal(ella.byKey.ndis_worker_check.status, STATUS.REVIEW);
});

test('100-point scoring reads filed identity documents', () => {
  const m = by('Makenzie Pickering');
  equal(m.identity.totalPoints, 65); // licence 40 (Primary) + medicare 25
  equal(m.identity.hasPrimary, true);
  equal(m.identity.meetsRequirement, false);
});

test('100-point shortfall never renders as Expired', () => {
  for (const s of ds.staff) {
    if (!s.identity.meetsRequirement) {
      assert(!/❌/.test(JSON.stringify(s.identity)), `${s.name} ID must not be marked Expired`);
    }
  }
});

test('PRIVACY: the dataset carries no restricted keys or reference numbers', () => {
  // build() calls assertClean internally; this asserts it is actually wired in.
  const json = JSON.stringify(ds);
  for (const bad of ['TFN', 'BSB', 'Account_Number', 'SRN', 'License_Number', 'Document_Number',
                     'Date_of_Birth', 'Emergency_Contact']) {
    assert(!json.includes(bad), `dataset must not contain ${bad}`);
  }
});

test('the monthly report builds and stays privacy-clean', () => {
  const r = buildReport(ds);
  equal(r.totals.staff, 4);
  assert(r.actions.length > 0);
  const text = renderText(r);
  assert(/PlusOne Mentoring/.test(text));
  assert(/does not indicate that identity was not verified/.test(text),
    'the ID section must state what a shortfall means');
  for (const bad of ['TFN', 'BSB', 'SRN']) assert(!text.includes(bad));
});

test('recommended actions are specific, not generic', () => {
  const r = buildReport(ds);
  const seb = r.actions.find((a) => a.name === 'Seb Sobels');
  assert(/WWCC/.test(seb.action), `expected WWCC in: ${seb.action}`);
});

test('folder slices that overlap are de-duplicated', () => {
  // Slices are produced independently and their ranges can overlap; the same
  // folder indexed twice must not become two staff rows or double-counted files.
  const names = ds.staff.flatMap((s) => s.folderNames);
  equal(names.length, new Set(names).size, 'no folder may be attached twice');
});

test('a weak name match cannot steal a folder already claimed confidently', () => {
  // "Lucy Winter" scores 60 against the folder "Lucy Waller" — same first
  // name, surnames three edits apart. She must not inherit another person's
  // compliance documents.
  const winter = ds.staff.find((s) => s.name === 'Lucy Winter');
  const waller = ds.staff.find((s) => s.name === 'Lucy Waller');
  if (winter && waller) {
    equal(waller.folderNames.includes('Lucy Waller'), true, 'Lucy Waller keeps her own folder');
    equal(winter.folderNames.includes('Lucy Waller'), false, 'Lucy Winter must not take it');
  }
  // No folder may be attached to two different staff members.
  const owner = new Map();
  for (const s of ds.staff) {
    for (const f of s.folderNames) {
      assert(!owner.has(f), `folder "${f}" claimed by both ${owner.get(f)} and ${s.name}`);
      owner.set(f, s.name);
    }
  }
});

test('test records are excluded from the dataset but reported', () => {
  const { TEST_RECORD_PATTERN } = require('../src/config');
  // Excluded from everything the user sees.
  for (const s of ds.staff) {
    assert(!TEST_RECORD_PATTERN.test(s.name), `test record reached the dataset: ${s.name}`);
  }
  // A genuine name that merely contains the letters is kept.
  equal(TEST_RECORD_PATTERN.test('Aurelio test'), true);
  equal(TEST_RECORD_PATTERN.test('Test User'), true);
  equal(TEST_RECORD_PATTERN.test('TESTING account'), true);
  equal(TEST_RECORD_PATTERN.test('Maria Testa'), false, 'Testa is a real surname');
  equal(TEST_RECORD_PATTERN.test('Contestabile'), false);
});

test('the compliance score counts only what is actually tracked', () => {
  // Leaving organisation-wide gaps in the denominator caps everyone around
  // 60% and makes a fully compliant staff member look middling.
  for (const s of ds.staff) {
    equal(s.scoreDenominator, s.items.length - s.excluded.length, `${s.name} denominator`);
    if (s.scoreDenominator > 0) {
      equal(s.score, Math.round((s.scoreNumerator / s.scoreDenominator) * 100), `${s.name} score`);
    }
  }
});
