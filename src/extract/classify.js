'use strict';
/**
 * Classify staff evidence files by filename, and verify each file is a real
 * document rather than a placeholder or a misfile.
 *
 * Filenames in the SharePoint tree are inconsistent in practice — observed
 * examples include `WWCC {ickering, Makenzie.jpg` and `certificate_3464824.pdf`
 * — so matching is deliberately loose, and anything that cannot be matched
 * confidently is reported rather than silently dropped.
 */

const MIN_FILE_BYTES = 1024; // below this a "document" is a stub, not evidence.

const DOC_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'tif', 'tiff',
  'doc', 'docx', 'odt', 'rtf',
]);

/**
 * Compliance-requirement classifiers. Order matters: the first match wins, so
 * more specific patterns are listed before more general ones.
 */
const COMPLIANCE_PATTERNS = [
  ['orientation',       /(worker[\s_-]*orientation|ndis[\s_-]*orientation|induction[\s_-]*module)/i],
  ['ndis_worker_check', /(ndis[\s_-]*worker[\s_-]*(check|screen)|ndiswc|worker[\s_-]*screening|ndis[\s_-]*check)/i],
  ['wwcc',              /(wwcc|working[\s_-]*with[\s_-]*children|\bwwc\b|dhs[\s_-]*screening)/i],
  ['police',            /(police[\s_-]*check|police[\s_-]*clearance|npc\b|national[\s_-]*police|criminal[\s_-]*history)/i],
  ['infection',         /(infection[\s_-]*control|basic[\s_-]*infection|infection[\s_-]*prevention)/i],
  ['first_aid',         /(first[\s_-]*aid|hltaid0?1[01]|hltaid)/i],
  ['cpr',               /(\bcpr\b|hltaid009|resuscitation)/i],
  ['registration',      /(car[\s_-]*rego|vehicle[\s_-]*rego|\brego\b|car[\s_-]*registration|vehicle[\s_-]*registration)/i],
  ['insurance',         /(insurance|comprehensive[\s_-]*car|ctp\b)/i],
  ['drivers_licence',   /(driver'?s?[\s_-]*licen[cs]e|drivers?[\s_-]*lic|\bdl[\s_-]*card\b)/i],
];

/**
 * 100-point identification document classifiers.
 * Keys correspond to src/rules/hundred-point.js DOCUMENTS[].key
 */
const IDENTITY_PATTERNS = [
  ['au_passport',               /(australian[\s_-]*passport|aus[\s_-]*passport|^passport|[\s_-]passport)/i],
  ['foreign_passport',          /(foreign[\s_-]*passport|overseas[\s_-]*passport)/i],
  ['citizenship_certificate',   /(citizenship)/i],
  ['full_birth_certificate',    /(full[\s_-]*birth|birth[\s_-]*certificate)/i],
  ['birth_certificate_extract', /(birth[\s_-]*extract|extract[\s_-]*of[\s_-]*birth)/i],
  ['medicare_card',             /(medicare)/i],
  ['centrelink_card',           /(centrelink)/i],
  ['dva_card',                  /(veterans?[\s_-]*affairs|\bdva\b)/i],
  ['bank_statement',            /(bank[\s_-]*statement)/i],
  ['credit_card',               /(credit[\s_-]*card|account[\s_-]*card)/i],
  ['marriage_certificate',      /(marriage[\s_-]*certificate)/i],
  ['change_of_name',            /(change[\s_-]*of[\s_-]*name|deed[\s_-]*poll)/i],
  ['decree_nisi',               /(decree[\s_-]*(nisi|absolute))/i],
  ['utility_bill',              /(utility[\s_-]*bill|electricity[\s_-]*bill|gas[\s_-]*bill|telephone[\s_-]*bill)/i],
  ['property_lease',            /(lease[\s_-]*agreement|tenancy[\s_-]*agreement|rental[\s_-]*agreement)/i],
  ['tax_assessment',            /(tax(ation)?[\s_-]*assessment|notice[\s_-]*of[\s_-]*assessment)/i],
  ['mortgage_documents',        /(mortgage)/i],
  ['rating_authority',          /(land[\s_-]*rates|council[\s_-]*rates|rates[\s_-]*notice)/i],
  ['tertiary_student_id',       /(student[\s_-]*(id|card)|tertiary[\s_-]*id)/i],
  ['government_employee_id',    /(government[\s_-]*(employee[\s_-]*)?id)/i],
  ['defence_id',                /(defence[\s_-]*(force[\s_-]*)?id)/i],
  ['drivers_licence',           /(driver'?s?[\s_-]*licen[cs]e|drivers?[\s_-]*lic)/i],
];

/** Files that are never compliance evidence. */
const NON_EVIDENCE = /(employee[\s_-]*handbook|employment[\s_-]*contract|employee[\s_-]*contract|profile[\s_-]*photo|headshot|\bbio\b|resume|cv\b|payslip|superannuation[\s_-]*choice|tax[\s_-]*file[\s_-]*declaration)/i;

function extensionOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function matchFirst(patterns, name) {
  for (const [key, re] of patterns) if (re.test(name)) return key;
  return null;
}

/**
 * Verify a file is a usable document.
 * @returns {{valid:boolean, reason:string|null}}
 */
function verifyFile(file) {
  const name = file.name || '';
  const ext = extensionOf(name);
  if (!ext) return { valid: false, reason: 'file has no extension' };
  if (!DOC_EXTENSIONS.has(ext)) return { valid: false, reason: `unsupported file type .${ext}` };
  const size = typeof file.size === 'number' ? file.size : null;
  if (size === null) return { valid: false, reason: 'file size unavailable' };
  if (size === 0) return { valid: false, reason: 'file is empty (0 bytes)' };
  if (size < MIN_FILE_BYTES) return { valid: false, reason: `file is only ${size} bytes — likely a placeholder` };
  return { valid: true, reason: null };
}

/**
 * Classify one file.
 * @returns {{name,size,complianceKey,identityKey,valid,reason,ignored}}
 */
function classifyFile(file) {
  const name = file.name || '';
  const check = verifyFile(file);

  if (NON_EVIDENCE.test(name)) {
    return { name, size: file.size ?? null, complianceKey: null, identityKey: null,
             valid: check.valid, reason: check.reason, ignored: true };
  }

  return {
    name,
    size: file.size ?? null,
    complianceKey: matchFirst(COMPLIANCE_PATTERNS, name),
    identityKey: matchFirst(IDENTITY_PATTERNS, name),
    valid: check.valid,
    reason: check.reason,
    ignored: false,
  };
}

/**
 * Classify every file in a staff folder.
 * @param {Array} files [{name,size}]
 * @returns {{evidence:Object, identity:Array, unclassified:Array, rejected:Array}}
 */
function classifyFolder(files = []) {
  const evidence = {};
  const identity = [];
  const unclassified = [];
  const rejected = [];

  for (const raw of files) {
    const f = classifyFile(raw);
    if (f.ignored) continue;

    if (!f.valid) rejected.push({ name: f.name, reason: f.reason });

    if (f.complianceKey) {
      (evidence[f.complianceKey] ||= []).push({ name: f.name, size: f.size, valid: f.valid, reason: f.reason });
    }
    if (f.identityKey && f.valid) {
      identity.push({ key: f.identityKey, name: f.name });
    }
    if (!f.complianceKey && !f.identityKey) {
      unclassified.push(f.name);
    }
  }

  return { evidence, identity, unclassified, rejected };
}

module.exports = {
  MIN_FILE_BYTES,
  DOC_EXTENSIONS,
  COMPLIANCE_PATTERNS,
  IDENTITY_PATTERNS,
  classifyFile,
  classifyFolder,
  verifyFile,
  extensionOf,
};
