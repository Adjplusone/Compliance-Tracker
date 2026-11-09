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
  assert(/unsupported file type/.test(r.reason));
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
  equal(r.rejected.length, 0);
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
