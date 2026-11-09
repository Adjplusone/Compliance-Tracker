'use strict';
/**
 * Match Zoho `Vendors` staff records to SharePoint folders.
 *
 * The two naming systems drift in practice:
 *   - Zoho splits the name across Vendor_Name + Staff_Last_Name.
 *   - Some folders are surname-first: `Luhrs, Ella`.
 *   - One person can own two folders (`Ella Luhrs` AND `Luhrs, Ella`), whose
 *     contents must be merged rather than one silently winning.
 *   - Spellings differ (`Christian Nardocci` vs Zoho `Nardinocchi`).
 *   - Zoho name fields sometimes carry notes
 *     (`Jacob DON'T SEND ONBOARDING FORM YET`).
 *
 * Nothing is dropped silently: every staff member and every folder ends up in
 * `matched`, `unmatchedStaff` or `unmatchedFolders`.
 */

/** Strip operational notes that have been typed into a Zoho name field. */
function stripNotes(name) {
  return String(name || '')
    .replace(/\b(DON'?T|DO NOT|PLEASE|TBC|TEST)\b[^,]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Luhrs, Ella` -> `Ella Luhrs`. Leaves other names untouched. */
function unflip(name) {
  const s = String(name || '').trim();
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  return m ? `${m[2].trim()} ${m[1].trim()}` : s;
}

/** Lowercase, unaccent, drop punctuation, collapse whitespace. */
function normalise(name) {
  return unflip(stripNotes(name))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sorted token signature, so word order cannot cause a miss. */
function signature(name) {
  return normalise(name).split(' ').filter(Boolean).sort().join(' ');
}

function tokens(name) {
  return normalise(name).split(' ').filter(Boolean);
}

/** Levenshtein distance, used only as a last-resort tie-breaker. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Score a candidate pairing. Higher is better; null means "not a match".
 *  100 exact signature
 *   90 same surname + same first name
 *   80 same surname + first-initial match (Dan / Daniel, Olli / Oliver)
 *   70 same surname + close first name (edit distance <= 2)
 *   60 same first name + close surname (Nardocci / Nardinocchi)
 */
function score(staffName, folderName) {
  if (signature(staffName) === signature(folderName)) return 100;

  const s = tokens(staffName);
  const f = tokens(folderName);
  if (!s.length || !f.length) return null;

  const sFirst = s[0], sLast = s[s.length - 1];
  const fFirst = f[0], fLast = f[f.length - 1];

  if (sLast === fLast) {
    if (sFirst === fFirst) return 90;
    if (sFirst[0] === fFirst[0] && (sFirst.startsWith(fFirst) || fFirst.startsWith(sFirst))) return 80;
    if (levenshtein(sFirst, fFirst) <= 2) return 70;
  }
  if (sFirst === fFirst && sLast !== fLast) {
    const d = levenshtein(sLast, fLast);
    if (d <= 3 && Math.max(sLast.length, fLast.length) > 5) return 60;
  }
  return null;
}

/**
 * @param {Array} staff   [{id, Vendor_Name, Staff_Last_Name, Staff_Status, ...}]
 * @param {Array} folders [{folder, files:[...]}]
 */
function matchStaffToFolders(staff, folders) {
  // Strip notes from the GIVEN-name field only. A note typed into Vendor_Name
  // runs to the end of that field, so stripping the joined string would also
  // eat the surname that follows it.
  const staffEntries = staff.map((r) => ({
    record: r,
    displayName: [stripNotes(r.Vendor_Name), String(r.Staff_Last_Name || '').trim()]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
  }));

  const used = new Map(); // folder index -> staff index
  const assigned = new Map(); // staff index -> {folderIndices, confidence, folderNames}
  const ambiguous = [];

  /*
   * Matching runs in two passes, and a folder can only be claimed once.
   *
   * Without this, a weak match steals a folder that belongs to someone else:
   * "Lucy Winter" scores 60 against the folder "Lucy Waller" (same first name,
   * surnames three edits apart) and would inherit another person's compliance
   * documents wholesale. Confident matches are therefore settled first, and
   * the fuzzy pass only sees folders nobody else has claimed.
   */
  const CONFIDENT = 90;

  const candidatesFor = (name, skipClaimed) => {
    const out = [];
    folders.forEach((f, fi) => {
      if (skipClaimed && used.has(fi)) return;
      const sc = score(name, f.folder);
      if (sc !== null) out.push({ fi, score: sc, folder: f.folder });
    });
    return out.sort((a, b) => b.score - a.score);
  };

  const claim = (si, take, best) => {
    for (const c of take) used.set(c.fi, si);
    assigned.set(si, {
      folderIndices: take.map((c) => c.fi),
      confidence: best,
      folderNames: take.map((c) => c.folder),
    });
  };

  // Pass 1 — exact and near-exact matches settle first.
  staffEntries.forEach((entry, si) => {
    const candidates = candidatesFor(entry.displayName, false)
      .filter((c) => c.score >= CONFIDENT && !used.has(c.fi));
    if (!candidates.length) return;
    const best = candidates[0].score;
    // One person can own two folders (`Ella Luhrs` and `Luhrs, Ella`); both
    // score the same, so take every top-scoring candidate and merge them.
    claim(si, candidates.filter((c) => c.score === best), best);
  });

  // Pass 2 — approximate matches, over folders nobody has claimed.
  staffEntries.forEach((entry, si) => {
    if (assigned.has(si)) return;
    const candidates = candidatesFor(entry.displayName, true);
    if (!candidates.length) return;
    const best = candidates[0].score;
    const take = candidates.filter((c) => c.score === best);
    if (take.length > 1) {
      ambiguous.push({ staff: entry.displayName, candidates: take.map((c) => c.folder), score: best });
    }
    claim(si, take, best);
  });

  const matched = staffEntries.map((_, si) =>
    ({ staffIndex: si, ...(assigned.get(si) || { folderIndices: [], confidence: null, folderNames: [] }) }));

  const results = matched.map((m) => {
    const entry = staffEntries[m.staffIndex];
    const files = [];
    for (const fi of m.folderIndices) for (const file of folders[fi].files || []) files.push(file);
    return {
      staffId: entry.record.id,
      name: entry.displayName,
      staffStatus: entry.record.Staff_Status,
      zoho: entry.record,
      folderNames: m.folderNames,
      mergedFolders: m.folderIndices.length > 1,
      matchConfidence: m.confidence,
      files,
    };
  });

  const unmatchedStaff = results.filter((r) => r.folderNames.length === 0)
    .map((r) => ({ staffId: r.staffId, name: r.name, staffStatus: r.staffStatus }));

  const unmatchedFolders = folders
    .map((f, fi) => ({ fi, folder: f.folder, fileCount: (f.files || []).length }))
    .filter((f) => !used.has(f.fi))
    .map(({ folder, fileCount }) => ({ folder, fileCount }));

  return { matched: results, unmatchedStaff, unmatchedFolders, ambiguous };
}

module.exports = { normalise, signature, unflip, stripNotes, score, levenshtein, matchStaffToFolders };
