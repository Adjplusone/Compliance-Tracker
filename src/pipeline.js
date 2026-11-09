'use strict';
/**
 * Build the compliance dataset from the raw pulls in data/raw/.
 *
 * This module is a PURE TRANSFORM. It performs no network calls: the Zoho and
 * SharePoint pulls are made by the agent session and written to data/raw/,
 * then this runs over them. That keeps the logic testable and lets the monthly
 * scheduled run re-use exactly the code that was verified here.
 *
 *   node src/pipeline.js [--today YYYY-MM-DD]
 */

const fs = require('fs');
const path = require('path');

const { REQUIREMENTS, STATUS, TRACK } = require('./config');
const { evaluateStaff } = require('./rules/compliance');
const { scoreIdentity } = require('./rules/hundred-point');
const { classifyFolder } = require('./extract/classify');
const { matchStaffToFolders } = require('./sources/match');
const { assertClean } = require('./privacy');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'out');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function loadFolders(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^folders-\d+\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`No folders-N.json found in ${dir}`);
  const all = [];
  for (const f of files) {
    const data = loadJSON(path.join(dir, f));
    for (const folder of data.folders || []) all.push(folder);
  }
  return { folders: all, sliceFiles: files };
}

/**
 * Assemble the merged value map for one staff member.
 * Zoho is the source of truth; `source` records provenance for the Notes column.
 */
function buildValues(zoho) {
  const values = {};
  for (const req of REQUIREMENTS) {
    const v = zoho[req.dateField];
    values[req.dateField] = {
      value: v == null || v === '' ? null : v,
      source: v == null || v === '' ? null : 'Zoho',
    };
  }
  return values;
}

function build(options = {}) {
  const today = options.today ? new Date(`${options.today}T00:00:00Z`) : new Date();
  const rawDir = options.rawDir || RAW;
  const zoho = loadJSON(path.join(rawDir, 'zoho-staff.json'));
  const { folders, sliceFiles } = loadFolders(rawDir);

  const match = matchStaffToFolders(zoho.records, folders);

  const staff = match.matched.map((m) => {
    const { evidence, identity, unclassified, rejected } = classifyFolder(m.files);
    const record = {
      staffId: m.staffId,
      name: m.name,
      staffStatus: m.staffStatus,
      values: buildValues(m.zoho),
      evidence,
    };

    const result = evaluateStaff(record, today);
    const idScore = scoreIdentity(identity);

    return {
      ...result,
      folderNames: m.folderNames,
      mergedFolders: m.mergedFolders,
      matchConfidence: m.matchConfidence,
      fileCount: m.files.length,
      identity: idScore,
      unclassifiedFiles: unclassified,
      rejectedFiles: rejected,
      notes: buildNotes(m, result, idScore, rejected, today),
    };
  });

  staff.sort((a, b) => a.name.localeCompare(b.name));

  const dataset = {
    generatedAt: today.toISOString().slice(0, 10),
    source: { zohoPulledAt: zoho.pulledAt, zohoCount: zoho.count, folderSlices: sliceFiles, folderCount: folders.length },
    staff,
    reconciliation: {
      zohoRecords: zoho.records.length,
      matchedStaff: staff.filter((s) => s.folderNames.length > 0).length,
      unmatchedStaff: match.unmatchedStaff,
      unmatchedFolders: match.unmatchedFolders,
      ambiguous: match.ambiguous,
      lowConfidenceMatches: staff
        .filter((s) => s.matchConfidence !== null && s.matchConfidence < 90)
        .map((s) => ({ name: s.name, folders: s.folderNames, confidence: s.matchConfidence })),
    },
    summary: summarise(staff),
  };

  // Hard gate: nothing restricted may reach the dashboard or the email.
  assertClean(dataset, 'compliance dataset');
  return dataset;
}

function buildNotes(m, result, idScore, rejected, today) {
  const todayISO = today.toISOString().slice(0, 10);
  const notes = [];
  if (m.mergedFolders) notes.push(`Duplicate folders merged: ${m.folderNames.join(' + ')}`);
  if (m.matchConfidence !== null && m.matchConfidence < 90) {
    notes.push(`Folder matched by approximate name (confidence ${m.matchConfidence}) — verify`);
  }
  if (m.folderNames.length === 0) notes.push('No SharePoint folder located — document evidence unverified');
  for (const r of rejected) notes.push(`File failed verification: ${r.name} (${r.reason})`);
  if (!idScore.meetsRequirement && idScore.totalPoints > 0) {
    notes.push(`100-point ID: ${idScore.totalPoints}/100 from filed evidence — ${idScore.reason}`);
  }
  // A one-time item is evidenced by a date in the PAST. A future issue or
  // completion date is a data-entry error, not a compliance state.
  const futureIssue = result.items.filter((i) => i.track === TRACK.ONE_TIME && i.date && i.date > todayISO);
  for (const i of futureIssue) notes.push(`${i.label} date is in the future (${i.date}) — likely data entry error`);
  return notes;
}

function summarise(staff) {
  const counts = { total: staff.length, byStatus: {}, followUp: 0 };
  for (const s of staff) {
    if (s.followUpRequired) counts.followUp++;
    for (const item of s.items) {
      counts.byStatus[item.key] ||= {};
      counts.byStatus[item.key][item.status] = (counts.byStatus[item.key][item.status] || 0) + 1;
    }
  }
  counts.identity = {
    meeting: staff.filter((s) => s.identity.meetsRequirement).length,
    notMeeting: staff.filter((s) => !s.identity.meetsRequirement).length,
  };
  counts.expired = staff.filter((s) => s.items.some((i) => i.status === STATUS.EXPIRED)).length;
  counts.expiringSoon = staff.filter((s) => s.items.some((i) => i.status === STATUS.EXPIRING)).length;
  return counts;
}

if (require.main === module) {
  const argTodayIdx = process.argv.indexOf('--today');
  const today = argTodayIdx > -1 ? process.argv[argTodayIdx + 1] : undefined;
  const dataset = build({ today });
  fs.mkdirSync(OUT, { recursive: true });
  const outPath = path.join(OUT, 'compliance.json');
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  const r = dataset.reconciliation;
  console.log(`Wrote ${outPath}`);
  console.log(`  staff: ${dataset.staff.length}  matched to a folder: ${r.matchedStaff}`);
  console.log(`  unmatched staff: ${r.unmatchedStaff.length}  unmatched folders: ${r.unmatchedFolders.length}`);
  console.log(`  needing follow-up: ${dataset.summary.followUp}`);
}

module.exports = { build, buildValues, summarise };
