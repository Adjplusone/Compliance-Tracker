'use strict';
const { test, assert, equal } = require('./run');
const { classifyFile, classifyFolder, verifyFile } = require('../src/extract/classify');

test('rejects a 0-byte file', () => {
  const r = verifyFile({ name: 'Police_Check.pdf', size: 0 });
  equal(r.valid, false);
  assert(/empty/.test(r.reason));
});
test('rejects a stub file below the minimum size', () => {
  const r = verifyFile({ name: 'Police_Check.pdf', size: 40 });
  equal(r.valid, false);
  assert(/placeholder/.test(r.reason));
});
test('rejects a non-document file type', () => {
  const r = verifyFile({ name: 'notes.exe', size: 500000 });
  equal(r.valid, false);
  assert(/cannot be verified automatically/.test(r.reason));
});
test('rejects a file with no extension', () => {
  equal(verifyFile({ name: 'Police_Check', size: 500000 }).valid, false);
});
test('accepts a real document', () => {
  equal(verifyFile({ name: 'Police_Check.pdf', size: 100046 }).valid, true);
});

test('classifies the real, inconsistently named folder correctly', () => {
  const r = classifyFolder([
    { name: 'Basic_Infection_Makenzie_Pickering.pdf', size: 166929 },
    { name: 'Drivers_License_Makenzie_Pickering.HEIC', size: 1044768 },
    { name: 'First_Aid_Makenzie_Pickering.pdf', size: 249555 },
    { name: 'NDIS_Worker_Check_Makenzie_Pickering.png', size: 369427 },
    { name: 'NDIS_Worker_Orientation_Makenzie_Pickering.png', size: 369427 },
    { name: 'Police_Check_Makenzie_Pickering.pdf', size: 100046 },
    { name: 'WWCC {ickering, Makenzie.jpg', size: 211969 },
  ]);
  equal(Object.keys(r.evidence).sort().join(','),
    'drivers_licence,first_aid,infection,ndis_worker_check,orientation,police,wwcc');
  // The worker-check and orientation PNGs in this real folder are both
  // exactly 369427 bytes — one file filed under two names — so both are
  // flagged for review rather than counted as separate evidence.
  equal(r.rejected.length, 2);
  assert(r.rejected.every((f) => /same file renamed/.test(f.reason)));
});

test('orientation is not misread as a worker check', () => {
  equal(classifyFile({ name: 'NDIS_Worker_Orientation_X.pdf', size: 99999 }).complianceKey, 'orientation');
  equal(classifyFile({ name: 'NDIS_Worker_Check_X.png', size: 99999 }).complianceKey, 'ndis_worker_check');
});

test('handbooks, contracts and profile photos are ignored, not misfiled', () => {
  for (const n of ['PlusOne_Mentoring_Employee_Handbook.pdf', 'Employment_contract_-_Casual_Base_Rate.pdf',
                   'Profile_Photo_X.jpeg']) {
    equal(classifyFile({ name: n, size: 99999 }).ignored, true, n);
  }
});

test('an ambiguous filename is reported as unclassified, not guessed', () => {
  const r = classifyFolder([{ name: 'certificate_3464824.pdf', size: 249555 }]);
  equal(r.unclassified.length, 1);
  equal(Object.keys(r.evidence).length, 0);
});

test('a bad file still registers as evidence so it can be flagged for review', () => {
  const r = classifyFolder([{ name: 'Police_Check_X.pdf', size: 0 }]);
  equal(r.evidence.police.length, 1);
  equal(r.evidence.police[0].valid, false);
  equal(r.rejected.length, 1);
});

test('identity documents are picked up for 100-point scoring', () => {
  const r = classifyFolder([
    { name: 'Passport_X.pdf', size: 300000 },
    { name: 'Medicare_Card_X.jpg', size: 150000 },
    { name: 'Drivers_License_X.HEIC', size: 900000 },
  ]);
  equal(r.identity.map((i) => i.key).sort().join(','), 'au_passport,drivers_licence,medicare_card');
});

// --- hardening driven by what the live folders actually contain -------------
test('a named placeholder is rejected however large', () => {
  const r = verifyFile({ name: 'dummy_police_screening.pdf', size: 2085 });
  equal(r.valid, false);
  assert(/placeholder/.test(r.reason));
});
test('Black.png is recognised as a placeholder', () => {
  equal(verifyFile({ name: 'Black.png', size: 2235 }).valid, false);
});
test('a file too small to be a scanned document is rejected', () => {
  const r = verifyFile({ name: 'First_Aid_Anthony_Galea.jpg', size: 780 });
  equal(r.valid, false);
  const r2 = verifyFile({ name: 'NDIS_Worker_Check.jfif', size: 658 });
  equal(r2.valid, false);
  const r3 = verifyFile({ name: 'NDIS_Worker_Check_Eli_Giddings.pdf', size: 2089 });
  equal(r3.valid, false);
  assert(/too small for a scanned document/.test(r3.reason));
});
test('the smallest genuine document observed still passes', () => {
  // A real 21KB WWCC PDF from the live folders.
  equal(verifyFile({ name: 'WWCC_Makenzie_Pickering.pdf', size: 21841 }).valid, true);
});
test('two requirements backed by byte-identical files are both flagged', () => {
  const r = classifyFolder([
    { name: 'NDIS_Worker_Check_X.png', size: 369427 },
    { name: 'NDIS_Worker_Orientation_X.png', size: 369427 },
  ]);
  equal(r.rejected.length, 2);
  assert(/same file renamed/.test(r.rejected[0].reason));
});
test('identical sizes within ONE requirement are not flagged', () => {
  // Front and back of the same licence legitimately share a size.
  const r = classifyFolder([
    { name: 'Drivers_License_front.jpg', size: 90000 },
    { name: 'Drivers_License_back.jpg', size: 90000 },
  ]);
  equal(r.rejected.length, 0);
});
