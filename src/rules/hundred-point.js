'use strict';
/**
 * AFP National Police Check 100 Point Checklist (NPC FORM-8022, rev 18/04/2019).
 * Transcribed from the checklist supplied by PlusOne Mentoring.
 *
 * Rule: a minimum of 100 points AND at least ONE Primary document.
 * Foreign documents must be accompanied by an official translation.
 *
 * `requires` codes: N = Name, P = Photo, A = Address, S = Signature.
 */

const PRIMARY = 'primary';
const SECONDARY = 'secondary';

const DOCUMENTS = [
  // --- Primary -------------------------------------------------------------
  { key: 'foreign_passport',        label: 'Foreign Passport (current)',                       tier: PRIMARY,   points: 70, requires: 'N-P' },
  { key: 'au_passport',             label: 'Australian Passport',                              tier: PRIMARY,   points: 70, requires: 'N-P' },
  { key: 'citizenship_certificate', label: 'Australian Citizenship Certificate',               tier: PRIMARY,   points: 70, requires: 'N' },
  { key: 'full_birth_certificate',  label: 'Full Birth Certificate',                           tier: PRIMARY,   points: 70, requires: 'N' },
  { key: 'certificate_of_identity', label: 'Certificate of Identity',                          tier: PRIMARY,   points: 70, requires: 'N' },
  { key: 'drivers_licence',         label: "Australian Driver Licence / Learner's Permit",     tier: PRIMARY,   points: 40, requires: 'N-A-P' },
  { key: 'tertiary_student_id',     label: 'Australian Tertiary Student ID Card',              tier: PRIMARY,   points: 40, requires: 'N-P' },
  { key: 'regulatory_photo_id',     label: 'Photo ID issued for Australian regulatory purposes', tier: PRIMARY, points: 40, requires: 'N-P' },
  { key: 'government_employee_id',  label: 'Government employee ID (Federal/State/Territory)', tier: PRIMARY,   points: 40, requires: 'N-P' },
  { key: 'defence_id',              label: 'Defence Force Identity Card',                      tier: PRIMARY,   points: 40, requires: 'N-P' },
  // --- Secondary -----------------------------------------------------------
  { key: 'dva_card',                label: 'Department of Veterans Affairs card',              tier: SECONDARY, points: 40, requires: 'N-A' },
  { key: 'centrelink_card',         label: 'Centrelink card (with reference number)',          tier: SECONDARY, points: 40, requires: 'N-A' },
  { key: 'birth_certificate_extract', label: 'Birth Certificate Extract',                      tier: SECONDARY, points: 25, requires: 'N' },
  { key: 'birth_card',              label: 'Birth card (NSW BDM issue only)',                  tier: SECONDARY, points: 25, requires: 'N' },
  { key: 'medicare_card',           label: 'Medicare card',                                    tier: SECONDARY, points: 25, requires: 'N' },
  { key: 'credit_card',             label: 'Credit card or account card',                      tier: SECONDARY, points: 25, requires: 'N' },
  { key: 'marriage_certificate',    label: 'Australian Marriage certificate',                  tier: SECONDARY, points: 25, requires: 'N-S' },
  { key: 'decree_nisi',             label: 'Decree Nisi / Decree Absolute',                    tier: SECONDARY, points: 25, requires: 'N-S' },
  { key: 'change_of_name',          label: 'Change of name certificate',                       tier: SECONDARY, points: 25, requires: 'N-S' },
  { key: 'bank_statement',          label: 'Bank statement (showing transactions)',            tier: SECONDARY, points: 25, requires: 'N-A' },
  { key: 'property_lease',          label: 'Property lease agreement — current address',       tier: SECONDARY, points: 25, requires: 'N-A' },
  { key: 'tax_assessment',          label: 'Taxation assessment notice',                       tier: SECONDARY, points: 25, requires: 'N-A' },
  { key: 'mortgage_documents',      label: 'Australian Mortgage Documents — current address',  tier: SECONDARY, points: 25, requires: 'N-A' },
  { key: 'rating_authority',        label: 'Rating Authority — current address (e.g. Land Rates)', tier: SECONDARY, points: 25, requires: 'N-A' },
  { key: 'utility_bill',            label: 'Utility Bill — current address (<12 months old)',  tier: SECONDARY, points: 20, requires: 'N-A' },
  { key: 'indigenous_org_reference', label: 'Reference from Indigenous Organisation',          tier: SECONDARY, points: 20, requires: 'N-P' },
  { key: 'foreign_equivalent',      label: 'Documents issued outside Australia (translated)',  tier: SECONDARY, points: 20, requires: 'N-P' },
];

const BY_KEY = Object.fromEntries(DOCUMENTS.map((d) => [d.key, d]));
const REQUIRED_POINTS = 100;

/**
 * Score a staff member's sighted identification documents.
 *
 * IMPORTANT — reading the result correctly:
 * Zoho holds no inventory of identification documents, so this score is built
 * entirely from documents filed in the staff member's SharePoint folder. A
 * total below 100 therefore means "the evidence is not on file", NOT "this
 * person failed identity verification". `meetsRequirement: false` must be
 * surfaced as 🔍 Requires Review, never as ❌ Expired.
 *
 * @param {Array} sighted  [{key, name, expired?, valid?}]
 * @returns {object}
 */
function scoreIdentity(sighted = []) {
  const counted = [];
  const unrecognised = [];
  const seen = new Set();

  for (const doc of sighted) {
    const def = BY_KEY[doc.key];
    if (!def) { unrecognised.push(doc.name || doc.key); continue; }
    // One document type counts once, however many files were filed.
    if (seen.has(def.key)) continue;
    seen.add(def.key);
    counted.push({
      key: def.key,
      label: def.label,
      tier: def.tier,
      points: def.points,
      requires: def.requires,
      name: doc.name || null,
      expired: Boolean(doc.expired),
    });
  }

  // An expired identification document contributes no points.
  const contributing = counted.filter((d) => !d.expired);
  const totalPoints = contributing.reduce((sum, d) => sum + d.points, 0);
  const primaryCount = contributing.filter((d) => d.tier === PRIMARY).length;

  const hasPrimary = primaryCount > 0;
  const hasPoints = totalPoints >= REQUIRED_POINTS;
  const meetsRequirement = hasPrimary && hasPoints;

  const shortfall = Math.max(0, REQUIRED_POINTS - totalPoints);
  const reasons = [];
  if (!hasPoints) reasons.push(`${shortfall} points short of ${REQUIRED_POINTS}`);
  if (!hasPrimary) reasons.push('no Primary document on file');

  return {
    documents: counted,
    totalPoints,
    requiredPoints: REQUIRED_POINTS,
    primaryCount,
    hasPrimary,
    meetsRequirement,
    anyExpired: counted.some((d) => d.expired),
    expiredDocuments: counted.filter((d) => d.expired).map((d) => d.label),
    shortfall,
    reason: reasons.length ? reasons.join('; ') : null,
    unrecognised,
  };
}

module.exports = { DOCUMENTS, BY_KEY, REQUIRED_POINTS, PRIMARY, SECONDARY, scoreIdentity };
