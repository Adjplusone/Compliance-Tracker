'use strict';
/**
 * Flatten the compliance dataset into the rows the dashboard renders.
 *
 * One row per staff member, one column per requirement, plus the 100-point
 * identification block and the roll-up fields. Values are human-readable
 * strings so the dashboard can show them directly and so the CSV is useful
 * on its own.
 *
 *   node src/export.js
 */

const fs = require('fs');
const path = require('path');
const { REQUIREMENTS, STATUS_LABEL, TRACK, CATEGORIES } = require('./config');
const { assertClean } = require('./privacy');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'out');

/** `✅ 2030-03-04` / `❌ 2025-06-11 (497d ago)` / `⬜ Not held` */
function cell(item) {
  const s = item.status;
  if (s === '⬜') return '⬜ Not held';
  if (s === '🔍') return `🔍 ${item.date || 'Review'}`;
  if (item.track === TRACK.ONE_TIME) return `${s} ${item.date || ''}`.trim();
  if (s === '❌') return `❌ ${item.date} (${Math.abs(item.daysUntil)}d ago)`;
  if (s === '⚠️') return `⚠️ ${item.date} (${item.daysUntil}d)`;
  return `✅ ${item.date}`;
}

/** Worst status wins when rolling several requirements into one category. */
const SEVERITY = ['❌', '⚠️', '🔍', '⬜', '✅'];

function rollUp(staff, keys) {
  const items = keys.map((k) => staff.byKey[k]).filter(Boolean);
  if (!items.length) return { status: '✅', text: '—', compliant: 0, total: 0 };
  let worst = '✅';
  for (const i of items) {
    if (SEVERITY.indexOf(i.status) < SEVERITY.indexOf(worst)) worst = i.status;
  }
  const compliant = items.filter((i) => i.status === '✅').length;
  return { status: worst, text: `${worst} ${compliant}/${items.length}`, compliant, total: items.length };
}

/**
 * Requirements that are an organisation-wide gap are left out of the category
 * roll-up. Otherwise CPR, recorded for nobody, drags "Training & Certification"
 * to zero compliant for all 93 staff and hides the fact that First Aid is
 * largely in order. They are named beside the category instead.
 */
function systemicKeysOf(dataset) {
  return new Set((dataset.systemicGaps || []).map((g) => g.key));
}

function keysForCategory(catKey, excluded) {
  return REQUIREMENTS
    .filter((r) => r.category === catKey && !excluded.has(r.key))
    .map((r) => r.key);
}

function flatten(dataset) {
  const excluded = systemicKeysOf(dataset);
  const rows = dataset.staff.map((s) => {
    const row = {
      'Staff Name': s.name,
      'Status': s.staffStatus,
    };
    for (const req of REQUIREMENTS) {
      row[req.label] = cell(s.byKey[req.key]);
    }
    // Category roll-ups, so the register can lead with four columns rather
    // than ten. The worst status in a category wins, with the compliant
    // count beside it so the summary is not just a red flag with no scale.
    for (const cat of CATEGORIES) {
      row[cat.label] = rollUp(s, keysForCategory(cat.key, excluded)).text;
    }

    const id = s.identity;
    row['100 Point ID Status'] = id.meetsRequirement
      ? `✅ ${id.totalPoints} pts`
      : `🔍 ${id.totalPoints} pts`;
    row['ID Documents Submitted'] = id.documents.length
      ? id.documents.map((d) => d.label).join('; ')
      : 'None on file';
    row['Individual Point Values'] = id.documents.length
      ? id.documents.map((d) => `${d.label}=${d.points}`).join('; ')
      : '';
    row['Total ID Points'] = id.totalPoints;
    row['Meets 100 Point Requirement'] = id.meetsRequirement ? 'Yes' : 'No';
    row['ID Documents Expired'] = id.anyExpired ? 'Yes' : 'No';
    row['Compliance Score (%)'] = s.score;
    row['Expiry Alerts'] = s.expiryAlerts.length
      ? s.expiryAlerts.map((a) => `${a.label} ${a.status === '❌' ? 'expired' : `in ${a.daysUntil}d`}`).join('; ')
      : 'None';
    row['Follow-up Required'] = s.followUpRequired ? 'Yes' : 'No';
    row['Notes'] = s.notes.join(' | ');
    return row;
  });

  assertClean(rows, 'dashboard rows');
  return rows;
}

function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/**
 * Per-category tallies: how many staff are fully compliant in each category,
 * and how many have an issue of each kind somewhere in it.
 */
function categoryTally(dataset) {
  const excluded = systemicKeysOf(dataset);
  const labelOf = (k) => (REQUIREMENTS.find((r) => r.key === k) || {}).label || k;
  return CATEGORIES.map((cat) => {
    const keys = keysForCategory(cat.key, excluded);
    const dropped = REQUIREMENTS.filter((r) => r.category === cat.key && excluded.has(r.key));
    const rolled = dataset.staff.map((s) => rollUp(s, keys));
    const count = (g) => rolled.filter((r) => r.status === g).length;
    return {
      Category: cat.label,
      Requirements: keys.length,
      'Not Tracked': dropped.map((r) => r.label).join('; '),
      'Staff Fully Compliant': count('✅'),
      'Expiring Soon': count('⚠️'),
      Expired: count('❌'),
      'Requires Review': count('🔍'),
      Missing: count('⬜'),
      'Staff Total': dataset.staff.length,
      Description: cat.blurb,
    };
  });
}

/** Per-requirement status tallies, for the dashboard's summary strip. */
function statusTally(dataset) {
  const out = [];
  for (const req of REQUIREMENTS) {
    const counts = {};
    for (const s of dataset.staff) {
      const st = s.byKey[req.key].status;
      counts[st] = (counts[st] || 0) + 1;
    }
    out.push({
      Requirement: req.label,
      Track: req.track === TRACK.ONE_TIME ? 'One-time' : 'Renewal',
      Compliant: counts['✅'] || 0,
      'Expiring Soon': counts['⚠️'] || 0,
      Expired: counts['❌'] || 0,
      'Requires Review': counts['🔍'] || 0,
      Missing: counts['⬜'] || 0,
    });
  }
  return out;
}

if (require.main === module) {
  const dataset = JSON.parse(fs.readFileSync(path.join(OUT, 'compliance.json'), 'utf8'));
  const rows = flatten(dataset);
  const tally = statusTally(dataset);
  const cats = categoryTally(dataset);
  fs.writeFileSync(path.join(OUT, 'dashboard-rows.json'), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(OUT, 'dashboard-rows.csv'), toCSV(rows));
  fs.writeFileSync(path.join(OUT, 'requirement-tally.json'), JSON.stringify(tally, null, 2));
  fs.writeFileSync(path.join(OUT, 'requirement-tally.csv'), toCSV(tally));
  fs.writeFileSync(path.join(OUT, 'category-tally.json'), JSON.stringify(cats, null, 2));
  fs.writeFileSync(path.join(OUT, 'category-tally.csv'), toCSV(cats));
  console.log(`rows: ${rows.length}, columns: ${Object.keys(rows[0] || {}).length}`);
  console.table(cats.map(({ Description, ...r }) => r));
  console.table(tally);
}

module.exports = { flatten, toCSV, statusTally, categoryTally, rollUp, cell };
