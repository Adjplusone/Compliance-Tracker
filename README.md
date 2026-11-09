# PlusOne Mentoring — Staff Compliance Tracker

Tracks compliance requirements for PlusOne Mentoring staff, scores 100-point
identification, and generates a monthly follow-up report.

NDIS provider 4050002983 · ABN 54 609 868 993 · Adelaide and approved regions.

## What it does

- Reads the staff register and compliance dates from **Zoho CRM `Vendors`**.
- Verifies that a real document backs each date, from the **SharePoint** staff
  folders under `General/3. Human Resource/1. Employees/`.
- Scores **100-point identification** against the AFP checklist (NPC FORM-8022).
- Produces a dashboard and a monthly follow-up email.

## Two kinds of requirement

Requirements do not all behave the same way, and conflating them produces
false alarms.

**One-time** — `NDIS Worker Orientation`, `Police Check`, `Infection Control`.
Taken once; there is no renewal cycle. The test is whether a real document is
on record with its completion date. No expiry is derived or invented.

**Renewal** — `NDIS Worker Check`, `WWCC`, `Driver's Licence`,
`Vehicle Registration`, `Vehicle Insurance`, `First Aid`, `CPR`.
Monitored against an expiry date, with alerts at 30, 60 and 90 days.

## Status meanings

| | Meaning |
|---|---|
| ✅ | Compliant |
| ⚠️ | Expiring within 90 days |
| ❌ | Expired |
| ⬜ | Missing — nothing on record |
| 🔍 | Requires review — evidence exists but cannot be confirmed |

**🔍 is not a failure.** It means the record is incomplete, most often an
expiry date that was never entered, or a document that could not be verified.

### Reading the 100-point ID score

Zoho holds no inventory of identification documents, so the score is built
from documents filed in each staff member's SharePoint folder. **A total below
100 means the evidence is not on file — not that the staff member failed
identity verification.** Anyone below 100 is flagged 🔍, never ❌.

## Field mapping (Zoho `Vendors`)

| Requirement | Track | Field |
|---|---|---|
| NDIS Worker Orientation | one-time | `Date_Issued` |
| Police Check | one-time | `Police_Check_Issue_Date` |
| Infection Control | one-time | `Infection_Control_Completion_date` |
| NDIS Worker Check | renewal | `NDIS_WC_Expiry` |
| WWCC | renewal | `WWCC_Expiry` |
| Driver's Licence | renewal | `Drivers_License_Expiry` |
| First Aid | renewal | `Renewal_Date` |
| CPR | renewal | `CPR_Renewal_Date` |
| Vehicle Registration | renewal | `Car_Registration_Expiry` |
| Vehicle Insurance | renewal | `Insurance_Term_Date` |

`Date_Issued` is Orientation and `Renewal_Date` is First Aid. Both were
confirmed against a staff member's onboarding form; see `test/pipeline.test.js`.

## Privacy

Zoho `Vendors` holds payroll, tax, superannuation and emergency-contact fields,
and the onboarding PDFs hold TFN, bank and date-of-birth details. None of it is
needed here and none of it is touched.

- The Zoho query selects an explicit whitelist (`src/config.js`).
- Reference numbers (licence, SRN, worker-check and certificate numbers) are
  **not queried at all** — evidence files already prove a document exists.
- `src/privacy.js` `assertClean()` runs over every output and **throws**, so a
  regression fails the build rather than reaching a dashboard or an email.
- `data/raw/` is gitignored.

## Running it

The Node code is a pure transform and makes no network calls. The Zoho and
SharePoint pulls are made by the agent session and written to `data/raw/`:

- `data/raw/zoho-staff.json` — the `Vendors` pull
- `data/raw/folders-N.json` — SharePoint folder index (name and size only)

```bash
npm test
```

```bash
npm run build
```

```bash
npm run report
```

## Layout

```
src/config.js            requirements, tracks, field mapping, privacy whitelist
src/privacy.js           assertClean guard, reference redaction
src/sources/match.js     Zoho <-> SharePoint folder name matching
src/extract/classify.js  document classification + file legitimacy checks
src/rules/compliance.js  the one-time / renewal status engine
src/rules/hundred-point.js  AFP 100-point identification scoring
src/pipeline.js          merge, evaluate, reconcile
src/export.js            flatten to dashboard rows and CSV
src/report/monthly.js    monthly follow-up report
```

## Known data issues this surfaces

- `NDIS_WC_Expiry` is blank for about a third of active staff, so those
  renewals cannot be monitored.
- `CPR_Renewal_Date`, `Car_Registration_Expiry` and `Insurance_Term_Date` are
  populated for only one or two staff.
- Some staff have two SharePoint folders (`Ella Luhrs` and `Luhrs, Ella`);
  these are merged, and the merge is recorded in the Notes column.
- A few date fields hold future issue dates, which is a data-entry error rather
  than a compliance state. These are flagged in Notes.
