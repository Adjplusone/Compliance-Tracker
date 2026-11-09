'use strict';
const { test, assert, equal } = require('./run');
const { findForbiddenKeys, assertClean, safeFileName } = require('../src/privacy');
const { ZOHO_FIELD_WHITELIST, FORBIDDEN_KEY_PATTERN } = require('../src/config');

// These are the real restricted field names on Zoho `Vendors`.
const RESTRICTED_ZOHO_FIELDS = [
  'TFN_Number', 'I_do_not_wish_to_provide_my_TFN', 'BSB', 'Account_Name', 'Account_Number',
  'Member_Name', 'You_member_number', 'APRA_or_RSA_Fund_Name', 'APRA_or_RSA_Fund_ABN',
  'APRA_or_RSA_Account_Name_if_applicable', 'APRA_or_RSA_Account_Number',
  'APRA_or_RSA_Member_number_if_applicable', 'APRA_or_RSA_Unique_Superannuation_Identifier_USI',
  'SMSF_Name', 'SMSF_ABN', 'SMSF_Provider', 'SMSF_BSB', 'SMSF_Account_Name', 'SMSF_Account_Number',
  'Super_Fund_Type', 'Date_of_Birth', 'Emergency_Contact_Name', 'Emergency_Contact_Number',
  'Emergency_Contact_Email', 'Emergency_Contact_Relation', 'Emergency_Contact_Street',
  'Emergency_Contact_Suburb', 'Emergency_Contact_Postcode', 'Street', 'City', 'Zip_Code',
  'Phone', 'Email', 'Biography',
];

test('the query whitelist excludes every restricted Zoho field', () => {
  for (const f of RESTRICTED_ZOHO_FIELDS) {
    assert(!ZOHO_FIELD_WHITELIST.includes(f), `whitelist must not contain ${f}`);
  }
});

test('every restricted field name is caught by the forbidden-key pattern', () => {
  for (const f of RESTRICTED_ZOHO_FIELDS) {
    assert(FORBIDDEN_KEY_PATTERN.test(f), `pattern must catch ${f}`);
  }
});

test('the forbidden-key pattern does not catch legitimate compliance fields', () => {
  const allowed = ['WWCC_Expiry', 'NDIS_WC_Expiry', 'Date_Issued', 'Renewal_Date',
    'Police_Check_Issue_Date', 'Infection_Control_Completion_date', 'Drivers_License_Expiry',
    'Car_Registration_Expiry', 'Insurance_Term_Date', 'CPR_Renewal_Date', 'Staff_Status',
    'Vendor_Name', 'Staff_Last_Name', 'score', 'status', 'items', 'evidence'];
  for (const f of allowed) {
    assert(!FORBIDDEN_KEY_PATTERN.test(f), `pattern must NOT catch ${f}`);
  }
});

test('findForbiddenKeys locates restricted keys at any depth', () => {
  const found = findForbiddenKeys({ staff: [{ name: 'A', payroll: { TFN_Number: '123' } }] });
  equal(found.length, 1);
  equal(found[0], '$.staff[0].payroll.TFN_Number');
});

test('assertClean throws on restricted data', () => {
  let threw = false;
  try { assertClean({ a: { BSB: '105066' } }, 'fixture'); } catch (e) {
    threw = true; assert(/PRIVACY VIOLATION/.test(e.message));
  }
  assert(threw, 'assertClean must throw');
});

test('assertClean throws on reference/document numbers', () => {
  let threw = false;
  try { assertClean({ row: { SRN: '0104-7447' } }, 'fixture'); } catch (e) {
    threw = true; assert(/reference\/document numbers/.test(e.message));
  }
  assert(threw, 'assertClean must reject reference numbers');
});

test('assertClean passes a clean compliance row', () => {
  assert(assertClean({
    name: 'Test Staff', staffStatus: 'Active', score: 80,
    items: [{ key: 'wwcc', status: '✅', date: '2030-03-04', daysUntil: 1211 }],
  }, 'clean row'));
});

test('safeFileName strips embedded document numbers', () => {
  equal(safeFileName('certificate_3464824.pdf'), 'certificate_….pdf');
  equal(safeFileName('WWCC_Smith.pdf'), 'WWCC_Smith.pdf');
});
