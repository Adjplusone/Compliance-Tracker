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

const { REQUIREMENTS, STATUS, TRACK, TEST_RECORD_PATTERN } = require('./config');
const { evaluateStaff } = require('./rules/compliance');
const { scoreIdentity } = require('./rules/hundred-point');
const { classifyFolder } = require('./extract/classify');
const { matchStaffToFolders } = require('./sources/match');
const { assertClean } = require('./privacy');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'out');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/**
 * Load every folder index slice and de-duplicate by folder name.
 *
 * The slices are produced independently and their ranges can overlap, so the
 * same folder may be indexed twice. Where two entries describe the same
 * folder identically, one is kept silently. Where they disagree, the union of
 * the files is kept and the conflict is reported rather than one copy
 * quietly winning.
 */
function loadFolders(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^folders-\d+\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`No folders-N.json found in ${dir}`);

  const byName = new Map();
  const conflicts = [];
  const sig = (list) => (list || []).map((x) => `${x.name}:${x.size}`).sort().join('|');

  for (const f of files) {
    const data = loadJSON(path.join(dir, f));
    for (const folder of data.folders || []) {
      const prev = byName.get(folder.folder);
      if (!prev) { byName.set(folder.folder, { ...folder, slices: [f] }); continue; }
      prev.slices.push(f);
      if (sig(prev.files) === sig(folder.files)) continue;
      const merged = new Map();
      for (const x of [...(prev.files || []), ...(folder.files || [])]) merged.set(`${x.name}:${x.size}`, x);
      prev.files = [...merged.values()];
      conflicts.push({ folder: folder.folder, slices: prev.slices.slice() });
    }
  }
  return { folders: [...byName.values()], sliceFiles: files, duplicateConflicts: conflicts };
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

/**
 * A requirement absent for nearly everyone is an organisational gap, not a
 * per-person failing. CPR and Vehicle Insurance are recorded for nobody;
 * counting those against all 93 staff puts everyone on the follow-up list and
 * buries the people who genuinely need chasing this month.
 *
 * Exported so the dashboard and the monthly email share one definition.
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

function build(options = {}) {
  const today = options.today ? new Date(`${options.today}T00:00:00Z`) : new Date();
  const rawDir = options.rawDir || RAW;
  const zoho = loadJSON(path.join(rawDir, 'zoho-staff.json'));
  const { folders, sliceFiles, duplicateConflicts } = loadFolders(rawDir);

  // Drop test records before anything else, so they cannot reach the
  // dashboard, the totals or the follow-up email. They are listed in the
  // reconciliation block rather than disappearing without trace.
  const isTestRecord = (r) =>
    TEST_RECORD_PATTERN.test(String(r.Vendor_Name || '')) ||
    TEST_RECORD_PATTERN.test(String(r.Staff_Last_Name || ''));
  const excludedTestRecords = zoho.records.filter(isTestRecord)
    .map((r) => ({
      staffId: r.id,
      name: [r.Vendor_Name, r.Staff_Last_Name].filter(Boolean).join(' ').trim(),
      staffStatus: r.Staff_Status,
      reason: 'Name identifies this as a test record, not a staff member',
    }));
  const liveRecords = zoho.records.filter((r) => !isTestRecord(r));

  const match = matchStaffToFolders(liveRecords, folders);

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

  // Re-derive follow-up once the organisation-wide gaps are known, so the
  // dashboard tile and the email agree on who needs chasing.
  const systemicGaps = findSystemicGaps(staff);
  const systemicKeys = new Set(systemicGaps.map((g) => g.key));
  for (const s of staff) {
    s.systemicExcluded = [...systemicKeys];
    s.actionableItems = s.items.filter((i) => !systemicKeys.has(i.key)).map((i) => i.key);
    s.followUpRequired = s.items.some((i) =>
      !systemicKeys.has(i.key) &&
      (i.status === STATUS.EXPIRED || i.status === STATUS.EXPIRING ||
       i.status === STATUS.MISSING || i.status === STATUS.REVIEW));

    // Score against what is actually tracked. Leaving CPR and the vehicle
    // fields in the denominator caps everyone around 60% and makes a staff
    // member who is compliant on every tracked requirement look middling,
    // which buries the people who are genuinely behind.
    const scored = s.items.filter((i) => !systemicKeys.has(i.key));
    const ok = scored.filter((i) => i.status === STATUS.COMPLIANT);
    s.scoreNumerator = ok.length;
    s.scoreDenominator = scored.length;
    s.score = scored.length ? Math.round((ok.length / scored.length) * 100) : null;
    s.excluded = [...systemicKeys];
  }

  const dataset = {
    generatedAt: today.toISOString().slice(0, 10),
    source: { zohoPulledAt: zoho.pulledAt, zohoCount: zoho.count, staffEvaluated: staff.length, folderSlices: sliceFiles, folderCount: folders.length },
    staff,
    systemicGaps,
    reconciliation: {
      zohoRecords: zoho.records.length,
      excludedTestRecords,
      matchedStaff: staff.filter((s) => s.folderNames.length > 0).length,
      unmatchedStaff: match.unmatchedStaff,
      unmatchedFolders: match.unmatchedFolders,
      ambiguous: match.ambiguous,
      duplicateFolderConflicts: duplicateConflicts,
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

module.exports = { build, buildValues, summarise, findSystemicGaps, SYSTEMIC_THRESHOLD };
