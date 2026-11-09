'use strict';
/**
 * Monthly compliance follow-up report.
 *
 * Produces the summary the operations team acts on:
 *   - staff with missing compliance requirements
 *   - staff with expired compliance
 *   - staff with compliance expiring within 30 / 60 / 90 days
 *   - staff whose 100-point identification is not evidenced
 *   - documents that failed the file legitimacy check
 *   - a recommended action per staff member
 *
 * Language is neutral and factual throughout: these reports are read by the
 * people named in them, and an NDIS compliance record is not the place for
 * loaded wording.
 *
 *   node src/report/monthly.js [--today YYYY-MM-DD]
 */

const fs = require('fs');
const path = require('path');
const { STATUS, REQUIREMENTS, TRACK } = require('../config');
const { assertClean } = require('../privacy');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'out');

const LABEL = Object.fromEntries(REQUIREMENTS.map((r) => [r.key, r.label]));
const TRACK_OF = Object.fromEntries(REQUIREMENTS.map((r) => [r.key, r.track]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The single most useful next step for this staff member. */
function recommendedAction(s) {
  const expired = s.items.filter((i) => i.status === STATUS.EXPIRED);
  if (expired.length) {
    return `Obtain renewed ${listOf(expired.map((i) => i.label))} before the next shift is allocated.`;
  }
  const noExpiry = s.items.filter((i) =>
    i.status === STATUS.REVIEW && TRACK_OF[i.key] === TRACK.RENEWAL && !i.date);
  if (noExpiry.length) {
    return `Record the expiry date for ${listOf(noExpiry.map((i) => i.label))} in Zoho so renewal can be tracked.`;
  }
  const soon = s.items.filter((i) => i.status === STATUS.EXPIRING)
    .sort((a, b) => a.daysUntil - b.daysUntil);
  if (soon.length) {
    return `Request renewal of ${listOf(soon.map((i) => i.label))} — ${soon[0].label} expires in ${soon[0].daysUntil} days.`;
  }
  const missing = s.items.filter((i) => i.status === STATUS.MISSING);
  if (missing.length) {
    return `Collect ${listOf(missing.map((i) => i.label))} and file in the staff folder.`;
  }
  const review = s.items.filter((i) => i.status === STATUS.REVIEW);
  if (review.length) {
    return `Review ${listOf(review.map((i) => i.label))}: ${review[0].reason}.`;
  }
  if (!s.identity.meetsRequirement) {
    return `Confirm 100-point identification and file the sighted documents.`;
  }
  return 'No action required.';
}

function listOf(items) {
  const u = [...new Set(items)];
  if (u.length === 1) return u[0];
  if (u.length === 2) return `${u[0]} and ${u[1]}`;
  return `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}

/**
 * A requirement absent for nearly everyone is an organisational gap, not a
 * per-person failing.
 *
 * CPR, Vehicle Registration and Vehicle Insurance are each recorded for one
 * or two of 93 staff. Listing those as individual follow-ups puts every
 * single staff member on the chase list and buries the twenty-odd people who
 * genuinely need action this month. They are reported once, at the top, as
 * something to fix in the process rather than ninety-three times as something
 * to fix per person.
 */
const SYSTEMIC_THRESHOLD = 0.8;

function findSystemicGaps(staff) {
  const gaps = [];
  for (const req of REQUIREMENTS) {
    const absent = staff.filter((s) => {
      const i = s.byKey[req.key];
      return i.status === STATUS.MISSING || (i.status === STATUS.REVIEW && !i.date);
    }).length;
    const share = staff.length ? absent / staff.length : 0;
    if (share >= SYSTEMIC_THRESHOLD) {
      gaps.push({ key: req.key, label: req.label, absent, total: staff.length,
                  percent: Math.round(share * 100) });
    }
  }
  return gaps;
}

function build(dataset) {
  const staff = dataset.staff;
  const systemic = findSystemicGaps(staff);
  const systemicKeys = new Set(systemic.map((g) => g.key));
  /** Items a named individual can actually be chased for this month. */
  const actionable = (s) => s.items.filter((i) => !systemicKeys.has(i.key));

  const expired = [];
  const missing = [];
  const bucket30 = [], bucket60 = [], bucket90 = [];
  const noExpiryRecorded = [];
  const idShortfall = [];
  const failedFiles = [];
  const duplicateEvidence = [];

  for (const s of staff) {
    const row = (items) => ({ name: s.name, staffStatus: s.staffStatus, items });

    const exp = s.items.filter((i) => i.status === STATUS.EXPIRED);
    if (exp.length) {
      expired.push(row(exp.map((i) => ({ label: i.label, date: i.date, daysAgo: Math.abs(i.daysUntil) }))));
    }

    const miss = actionable(s).filter((i) => i.status === STATUS.MISSING);
    if (miss.length) missing.push(row(miss.map((i) => i.label)));

    for (const a of s.expiryAlerts) {
      if (a.status !== STATUS.EXPIRING) continue;
      const entry = { name: s.name, label: a.label, date: a.date, days: a.daysUntil };
      if (a.daysUntil <= 30) bucket30.push(entry);
      else if (a.daysUntil <= 60) bucket60.push(entry);
      else bucket90.push(entry);
    }

    const noExp = actionable(s).filter((i) =>
      i.status === STATUS.REVIEW && TRACK_OF[i.key] === TRACK.RENEWAL && !i.date);
    if (noExp.length) noExpiryRecorded.push(row(noExp.map((i) => i.label)));

    if (!s.identity.meetsRequirement && s.identity.totalPoints > 0) {
      idShortfall.push({
        name: s.name,
        totalPoints: s.identity.totalPoints,
        hasPrimary: s.identity.hasPrimary,
        documents: s.identity.documents.map((d) => `${d.label} (${d.points})`),
        reason: s.identity.reason,
      });
    }

    for (const f of s.rejectedFiles || []) {
      if (/same file renamed/.test(f.reason)) duplicateEvidence.push({ name: s.name, file: f.name, reason: f.reason });
      else failedFiles.push({ name: s.name, file: f.name, reason: f.reason });
    }
  }

  const sortByDays = (a, b) => a.days - b.days;
  bucket30.sort(sortByDays); bucket60.sort(sortByDays); bucket90.sort(sortByDays);

  // Follow-up is judged on what an individual can be chased for, so the
  // organisation-wide gaps do not put all 93 staff on the list.
  const needsAction = (s) => actionable(s).some((i) =>
    i.status === STATUS.EXPIRED || i.status === STATUS.EXPIRING ||
    i.status === STATUS.MISSING || i.status === STATUS.REVIEW);

  const actions = staff
    .filter(needsAction)
    .map((s) => ({ name: s.name, staffStatus: s.staffStatus, score: s.score,
                   action: recommendedAction({ ...s, items: actionable(s) }) }));

  const report = {
    period: monthName(dataset.generatedAt),
    generatedAt: dataset.generatedAt,
    systemic,
    totals: {
      staff: staff.length,
      followUp: actions.length,
      systemicGaps: systemic.length,
      expired: expired.length,
      missing: missing.length,
      expiring30: bucket30.length,
      expiring60: bucket60.length,
      expiring90: bucket90.length,
      noExpiryRecorded: noExpiryRecorded.length,
      idShortfall: idShortfall.length,
      failedFiles: failedFiles.length,
      duplicateEvidence: new Set(duplicateEvidence.map((d) => d.name)).size,
    },
    expired,
    missing,
    expiring: { within30: bucket30, within60: bucket60, within90: bucket90 },
    noExpiryRecorded,
    idShortfall,
    failedFiles,
    duplicateEvidence,
    actions,
    reconciliation: dataset.reconciliation,
  };

  assertClean(report, 'monthly report');
  return report;
}

/** Plain-text body. Readable in any mail client, and quotable in a handover. */
function renderText(r) {
  const L = [];
  const rule = '='.repeat(66);
  L.push(`PlusOne Mentoring — Staff Compliance Follow-up`);
  L.push(`${r.period}  (generated ${r.generatedAt})`);
  L.push(rule, '');
  L.push(`${r.totals.staff} staff reviewed. ${r.totals.followUp} require individual follow-up.`);
  L.push('');

  L.push(`  Expired items                     ${r.totals.expired} staff`);
  L.push(`  Missing items                     ${r.totals.missing} staff`);
  L.push(`  Expiring within 30 days           ${r.totals.expiring30} items`);
  L.push(`  Expiring within 60 days           ${r.totals.expiring60} items`);
  L.push(`  Expiring within 90 days           ${r.totals.expiring90} items`);
  L.push(`  Renewal date not recorded         ${r.totals.noExpiryRecorded} staff`);
  L.push(`  100-point ID not evidenced        ${r.totals.idShortfall} staff`);
  if (r.totals.duplicateEvidence) L.push(`  Duplicate evidence                ${r.totals.duplicateEvidence} staff`);
  if (r.totals.failedFiles) L.push(`  Files needing manual check        ${r.totals.failedFiles}`);
  L.push('');
  if (r.systemic.length) {
    L.push('ORGANISATION-WIDE GAPS — not individual follow-ups', '-'.repeat(66));
    L.push('  These requirements are unrecorded for nearly all staff, which points');
    L.push('  to a gap in how the information is captured rather than to ninety-odd');
    L.push('  separate omissions. They are excluded from the individual actions');
    L.push('  below so that the staff who genuinely need chasing stay visible.');
    L.push('');
    for (const g of r.systemic) {
      L.push(`  ${g.label} — not recorded for ${g.absent} of ${g.total} staff (${g.percent}%)`);
    }
    L.push('');
  }

  if (r.expired.length) {
    L.push('EXPIRED — action required', '-'.repeat(66));
    for (const s of r.expired) {
      for (const i of s.items) L.push(`  ${s.name} — ${i.label}, expired ${i.date} (${i.daysAgo} days ago)`);
    }
    L.push('');
  }

  const sections = [['Expiring within 30 days', r.expiring.within30],
                    ['Expiring within 60 days', r.expiring.within60],
                    ['Expiring within 90 days', r.expiring.within90]];
  for (const [title, rows] of sections) {
    if (!rows.length) continue;
    L.push(title.toUpperCase(), '-'.repeat(66));
    for (const i of rows) L.push(`  ${i.name} — ${i.label}, expires ${i.date} (${i.days} days)`);
    L.push('');
  }

  if (r.missing.length) {
    L.push('MISSING — no record held', '-'.repeat(66));
    for (const s of r.missing) L.push(`  ${s.name} — ${s.items.join(', ')}`);
    L.push('');
  }

  if (r.noExpiryRecorded.length) {
    L.push('RENEWAL DATE NOT RECORDED', '-'.repeat(66));
    L.push('  Evidence is held but no expiry date is stored, so these renewals');
    L.push('  cannot be monitored automatically.');
    for (const s of r.noExpiryRecorded) L.push(`  ${s.name} — ${s.items.join(', ')}`);
    L.push('');
  }

  if (r.idShortfall.length) {
    L.push('100-POINT IDENTIFICATION — PARTIAL EVIDENCE ON FILE', '-'.repeat(66));
    L.push('  Points below are calculated from identification documents filed in');
    L.push('  each staff folder. A shortfall indicates the evidence is not on');
    L.push('  file; it does not indicate that identity was not verified. Staff');
    L.push('  with no identification filed at all are covered by the');
    L.push('  organisation-wide gaps above rather than listed individually.');
    for (const s of r.idShortfall) {
      const docs = s.documents.length ? s.documents.join(', ') : 'none on file';
      L.push(`  ${s.name} — ${s.totalPoints}/100. On file: ${docs}`);
    }
    L.push('');
  }

  if (r.duplicateEvidence.length) {
    const byStaff = new Map();
    for (const d of r.duplicateEvidence) {
      if (!byStaff.has(d.name)) byStaff.set(d.name, []);
      byStaff.get(d.name).push(d.file);
    }
    L.push('DUPLICATE EVIDENCE — one document filed against two requirements', '-'.repeat(66));
    L.push('  For the staff below, two different requirements are backed by files of');
    L.push('  identical size, meaning one document has been saved under two names.');
    L.push('  Both requirements appear evidenced, but only one document exists, so');
    L.push('  the second is unevidenced. Please confirm which is which and obtain');
    L.push('  the missing document.');
    L.push('');
    // A staff member with merged duplicate folders can list the same filename
    // twice; that is a folder artefact, not a second document.
    for (const [name, files] of byStaff) L.push(`  ${name} — ${[...new Set(files)].join(', ')}`);
    L.push('');
  }

  if (r.failedFiles.length) {
    L.push('DOCUMENTS NEEDING A MANUAL CHECK', '-'.repeat(66));
    for (const f of r.failedFiles) L.push(`  ${f.name} — ${f.file}: ${f.reason}`);
    L.push('');
  }

  L.push('RECOMMENDED ACTIONS', '-'.repeat(66));
  for (const a of r.actions) L.push(`  ${a.name} (${a.staffStatus}, ${a.score}%) — ${a.action}`);
  L.push('');

  const rec = r.reconciliation;
  L.push('DATA COVERAGE', '-'.repeat(66));
  const excluded = rec.excludedTestRecords || [];
  const evaluated = rec.zohoRecords - excluded.length;
  L.push(`  Staff records reviewed: ${evaluated}. Matched to a document folder: ${rec.matchedStaff}.`);
  if (excluded.length) {
    L.push(`  Excluded as test records: ${excluded.map((e) => e.name).join(', ')}`);
  }
  if (rec.unmatchedStaff.length) {
    L.push(`  No folder located for: ${rec.unmatchedStaff.map((s) => s.name).join(', ')}`);
  }
  if (rec.lowConfidenceMatches.length) {
    L.push('  Folder matched by approximate name (please confirm):');
    for (const m of rec.lowConfidenceMatches) L.push(`    ${m.name} -> ${m.folders.join(', ')}`);
  }
  L.push('');
  L.push('Compliance status is calculated from Zoho CRM records and documents');
  L.push('filed in SharePoint. Thank you,');
  L.push('PlusOne Mentoring');
  return L.join('\n');
}

if (require.main === module) {
  const dataset = JSON.parse(fs.readFileSync(path.join(OUT, 'compliance.json'), 'utf8'));
  const report = build(dataset);
  fs.writeFileSync(path.join(OUT, 'monthly-report.json'), JSON.stringify(report, null, 2));
  const text = renderText(report);
  fs.writeFileSync(path.join(OUT, 'monthly-report.txt'), text);
  console.log(text);
}

module.exports = { build, renderText, recommendedAction, monthName };
