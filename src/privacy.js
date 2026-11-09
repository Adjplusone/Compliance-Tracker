'use strict';
/**
 * Runtime privacy guard.
 *
 * Zoho `Vendors` carries 21 payroll/tax/super fields (TFN_Number, BSB,
 * Account_Number, SMSF/APRA) and 7 emergency-contact fields. The onboarding
 * PDFs carry TFN, bank, super, DOB and home address. None of it is needed to
 * answer "who lapses next month?", so none of it is allowed anywhere in this
 * pipeline's output.
 *
 * This is not advisory. `assertClean` throws, and the test suite runs it over
 * real pipeline output so a regression fails the build rather than quietly
 * leaking into a dashboard or an email.
 */

const { FORBIDDEN_KEY_PATTERN, REF_FIELDS } = require('./config');

/** Walk an object graph and collect every path whose key looks sensitive. */
function findForbiddenKeys(value, path = '$', found = []) {
  if (value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findForbiddenKeys(v, `${path}[${i}]`, found));
    return found;
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(k)) found.push(`${path}.${k}`);
    findForbiddenKeys(v, `${path}.${k}`, found);
  }
  return found;
}

/** Reference numbers prove a document exists; they are never rendered. */
function findReferenceValues(value, path = '$', found = []) {
  if (value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findReferenceValues(v, `${path}[${i}]`, found));
    return found;
  }
  for (const [k, v] of Object.entries(value)) {
    if (REF_FIELDS.includes(k)) found.push(`${path}.${k}`);
    findReferenceValues(v, `${path}.${k}`, found);
  }
  return found;
}

function assertClean(value, label = 'output') {
  const forbidden = findForbiddenKeys(value);
  if (forbidden.length) {
    throw new Error(
      `PRIVACY VIOLATION in ${label}: restricted keys present at ${forbidden.join(', ')}`
    );
  }
  const refs = findReferenceValues(value);
  if (refs.length) {
    throw new Error(
      `PRIVACY VIOLATION in ${label}: reference/document numbers present at ${refs.join(', ')}`
    );
  }
  return true;
}

/**
 * Reduce a raw Zoho record to a boolean "a reference number exists" marker,
 * discarding the number itself. This is how reference fields leave the
 * source layer — the value never travels further.
 */
function redactReferences(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (REF_FIELDS.includes(k)) {
      out[k] = { present: Boolean(String(v == null ? '' : v).trim()) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Scrub a filename that may embed a document number. */
function safeFileName(name) {
  return String(name || '').replace(/(?<![0-9])[0-9]{6,}(?![0-9])/g, '…');
}

module.exports = { findForbiddenKeys, findReferenceValues, assertClean, redactReferences, safeFileName };
