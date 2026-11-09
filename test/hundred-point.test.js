'use strict';
const { test, assert, equal } = require('./run');
const { scoreIdentity, DOCUMENTS, REQUIRED_POINTS } = require('../src/rules/hundred-point');

test('the AFP table has 10 Primary and 17 Secondary documents', () => {
  equal(DOCUMENTS.filter((d) => d.tier === 'primary').length, 10);
  equal(DOCUMENTS.filter((d) => d.tier === 'secondary').length, 17);
  equal(DOCUMENTS.length, 27);
});

test('AFP point values are transcribed correctly', () => {
  const pts = (k) => DOCUMENTS.find((d) => d.key === k).points;
  equal(pts('au_passport'), 70);
  equal(pts('full_birth_certificate'), 70);
  equal(pts('drivers_licence'), 40);
  equal(pts('centrelink_card'), 40);
  equal(pts('medicare_card'), 25);
  equal(pts('bank_statement'), 25);
  equal(pts('utility_bill'), 20);
  equal(REQUIRED_POINTS, 100);
});

test('licence only scores 40 and does not meet the requirement', () => {
  const r = scoreIdentity([{ key: 'drivers_licence', name: 'DL.HEIC' }]);
  equal(r.totalPoints, 40);
  equal(r.primaryCount, 1);
  equal(r.hasPrimary, true);
  equal(r.meetsRequirement, false);
  equal(r.shortfall, 60);
});

test('100+ points with no Primary document still fails', () => {
  const r = scoreIdentity([
    { key: 'medicare_card' }, { key: 'bank_statement' }, { key: 'centrelink_card' }, { key: 'utility_bill' },
  ]);
  assert(r.totalPoints >= 100, 'should clear the point threshold');
  equal(r.hasPrimary, false);
  equal(r.meetsRequirement, false);
  assert(/no Primary document/.test(r.reason));
});

test('a Primary plus enough Secondary points passes', () => {
  const r = scoreIdentity([{ key: 'au_passport' }, { key: 'medicare_card' }, { key: 'bank_statement' }]);
  equal(r.totalPoints, 120);
  equal(r.meetsRequirement, true);
  equal(r.reason, null);
});

test('an expired document contributes no points and is reported', () => {
  const r = scoreIdentity([{ key: 'au_passport', expired: true }, { key: 'medicare_card' }]);
  equal(r.totalPoints, 25);
  equal(r.anyExpired, true);
  equal(r.meetsRequirement, false);
  equal(r.expiredDocuments.length, 1);
});

test('duplicate files of one document type count once', () => {
  const r = scoreIdentity([
    { key: 'drivers_licence', name: 'DL_front.jpg' },
    { key: 'drivers_licence', name: 'DL_back.jpg' },
  ]);
  equal(r.totalPoints, 40);
  equal(r.documents.length, 1);
});

test('unrecognised documents are reported rather than silently scored', () => {
  const r = scoreIdentity([{ key: 'mystery_doc', name: 'thing.pdf' }]);
  equal(r.totalPoints, 0);
  equal(r.unrecognised.length, 1);
});

test('no evidence scores zero without asserting the person failed ID', () => {
  const r = scoreIdentity([]);
  equal(r.totalPoints, 0);
  equal(r.meetsRequirement, false);
  equal(r.documents.length, 0);
});
