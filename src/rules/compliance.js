'use strict';

const {
  STATUS,
  STATUS_LABEL,
  TRACK,
  REQUIREMENTS,
  ALERT_BUCKETS,
  EXPIRING_SOON_DAYS,
} = require('../config');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Parse an ISO (YYYY-MM-DD) date into a UTC-midnight Date, or null.
 *
 * Deliberately strict. The precedent `compliance-scanner` skill used
 * `new Date(value || '')`, which yields an Invalid Date for a missing value;
 * every subsequent comparison is then false and the staff member silently
 * lands in NEITHER the compliant set NOR the issues set — vanishing from the
 * report entirely. Here an unusable value returns null and the caller must
 * treat it as explicitly Missing. Covered by test/compliance.test.js.
 */
function parseDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  if (Number.isNaN(date.getTime())) return null;
  // Reject roll-over such as 2026-02-31.
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) {
    return null;
  }
  return date;
}

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Whole days from `today` until `date`. Negative when in the past. */
function daysUntil(date, today) {
  return Math.round((startOfUTCDay(date) - startOfUTCDay(today)) / MS_PER_DAY);
}

/**
 * Evaluate one requirement for one staff member.
 *
 * @param {object} req      a REQUIREMENTS entry
 * @param {object} record   merged staff record {values:{field:{value,source}}, evidence:{key:[file]}}
 * @param {Date}   today
 * @returns {object} {key,label,track,status,statusLabel,date,daysUntil,source,reason,evidence}
 */
function evaluateRequirement(req, record, today) {
  const cell = (record.values && record.values[req.dateField]) || {};
  const rawDate = cell.value == null ? null : cell.value;
  const source = cell.source || null;
  const date = parseDate(rawDate);

  const files = collectEvidence(req, record);
  const validFiles = files.filter((f) => f.valid);
  const invalidFiles = files.filter((f) => !f.valid);

  const hasRef = Boolean(
    req.refField && record.values && record.values[req.refField] &&
    String(record.values[req.refField].value || '').trim()
  );

  const base = {
    key: req.key,
    label: req.label,
    track: req.track,
    date: date ? rawDate : null,
    source,
    evidence: files.map((f) => ({ name: f.name, valid: f.valid, reason: f.reason || null })),
  };

  // No date and no evidence of any kind -> genuinely nothing on record.
  if (!date && validFiles.length === 0 && invalidFiles.length === 0 && !hasRef) {
    return finish({ ...base, status: STATUS.MISSING, daysUntil: null, reason: 'No date and no document on record' });
  }

  const fileFault = validFiles.length === 0 && invalidFiles.length > 0
    ? `Document on file failed verification: ${invalidFiles[0].reason}`
    : null;

  if (req.track === TRACK.ONE_TIME) {
    // A one-time requirement is evidenced by the document itself, so a file
    // that fails verification is decisive here.
    if (fileFault) {
      return finish({ ...base, status: STATUS.REVIEW, daysUntil: null, reason: fileFault });
    }
    // One-time: taken once, no renewal cycle. Needs a date AND a real file.
    if (!date) {
      return finish({
        ...base,
        status: STATUS.REVIEW,
        daysUntil: null,
        reason: 'Document on file but completion date not recorded',
      });
    }
    if (validFiles.length === 0) {
      return finish({
        ...base,
        status: STATUS.REVIEW,
        daysUntil: null,
        reason: 'Date recorded but no supporting document located',
      });
    }
    return finish({ ...base, status: STATUS.COMPLIANT, daysUntil: null, reason: null });
  }

  // Renewal track: the expiry date governs.
  if (!date) {
    return finish({
      ...base,
      status: STATUS.REVIEW,
      daysUntil: null,
      reason: 'Evidence on record but no expiry date captured — renewal cannot be monitored',
    });
  }

  const days = daysUntil(date, today);

  // The date is evaluated BEFORE any file fault. A document that fails
  // verification must never mask an expiry breach: an expired item stays
  // Expired, and the file problem is reported alongside it.
  if (days < 0) {
    const reason = `Expired ${Math.abs(days)} days ago`;
    return finish({ ...base, status: STATUS.EXPIRED, daysUntil: days,
      reason: fileFault ? `${reason}; ${fileFault}` : reason });
  }
  if (days <= EXPIRING_SOON_DAYS) {
    const reason = `Expires in ${days} days`;
    return finish({ ...base, status: STATUS.EXPIRING, daysUntil: days,
      reason: fileFault ? `${reason}; ${fileFault}` : reason });
  }
  // In date. Only here does a file fault downgrade the result.
  if (fileFault) {
    return finish({ ...base, status: STATUS.REVIEW, daysUntil: days, reason: fileFault });
  }
  if (validFiles.length === 0) {
    // In date per Zoho, but no document located to corroborate it.
    return finish({ ...base, status: STATUS.COMPLIANT, daysUntil: days, reason: null, unverified: true });
  }
  return finish({ ...base, status: STATUS.COMPLIANT, daysUntil: days, reason: null });
}

function finish(result) {
  result.statusLabel = STATUS_LABEL[result.status];
  return result;
}

function collectEvidence(req, record) {
  const evidence = record.evidence || {};
  const out = [];
  for (const k of req.fileKeys) {
    for (const f of evidence[k] || []) out.push(f);
  }
  return out;
}

/** Which alert bucket (30/60/90) a renewal item falls into, or null. */
function alertBucket(days) {
  if (days == null || days < 0) return null;
  for (const b of ALERT_BUCKETS) if (days <= b) return b;
  return null;
}

/**
 * Evaluate every requirement for a staff member and roll up a score.
 *
 * Compliance Score = compliant items / applicable items. An item is applicable
 * unless it is excluded (see `excludeKeys`). The denominator is returned so the
 * dashboard can state it rather than presenting a bare percentage.
 */
function evaluateStaff(record, today, options = {}) {
  const excludeKeys = new Set(options.excludeKeys || []);
  const items = REQUIREMENTS.map((req) => evaluateRequirement(req, record, today));

  const applicable = items.filter((i) => !excludeKeys.has(i.key));
  const compliant = applicable.filter((i) => i.status === STATUS.COMPLIANT);
  const score = applicable.length === 0 ? null : Math.round((compliant.length / applicable.length) * 100);

  const expiryAlerts = items
    .filter((i) => i.status === STATUS.EXPIRING || i.status === STATUS.EXPIRED)
    .map((i) => ({ key: i.key, label: i.label, status: i.status, date: i.date, daysUntil: i.daysUntil, bucket: alertBucket(i.daysUntil) }))
    .sort((a, b) => (a.daysUntil ?? -1e9) - (b.daysUntil ?? -1e9));

  const needsFollowUp = items.some((i) =>
    i.status === STATUS.EXPIRED || i.status === STATUS.EXPIRING ||
    i.status === STATUS.MISSING || i.status === STATUS.REVIEW
  );

  return {
    staffId: record.staffId,
    name: record.name,
    staffStatus: record.staffStatus,
    items,
    byKey: Object.fromEntries(items.map((i) => [i.key, i])),
    score,
    scoreDenominator: applicable.length,
    scoreNumerator: compliant.length,
    excluded: [...excludeKeys],
    expiryAlerts,
    followUpRequired: needsFollowUp,
  };
}

module.exports = {
  parseDate,
  daysUntil,
  alertBucket,
  evaluateRequirement,
  evaluateStaff,
  MS_PER_DAY,
};
