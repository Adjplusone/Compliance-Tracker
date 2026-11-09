'use strict';
/**
 * Compliance configuration for PlusOne Mentoring.
 *
 * Field mapping confirmed against Zoho `Vendors` AND cross-checked against an
 * `Employee Onboarding - <Name>.pdf` form (see test/mapping.test.js).
 */

// Statuses -------------------------------------------------------------------
const STATUS = {
  COMPLIANT: '✅',
  EXPIRING: '⚠️',
  EXPIRED: '❌',
  MISSING: '⬜',
  REVIEW: '🔍',
};

const STATUS_LABEL = {
  '✅': 'Compliant',
  '⚠️': 'Expiring Soon',
  '❌': 'Expired',
  '⬜': 'Missing',
  '🔍': 'Requires Review',
};

// Tracks ---------------------------------------------------------------------
// A = one-time: taken once, no renewal cycle. Verify a real document + date.
// B = renewal: monitored against an expiry date with 30/60/90-day alerting.
const TRACK = { ONE_TIME: 'A', RENEWAL: 'B' };

/**
 * The ten compliance requirements.
 *  key        - stable identifier used throughout the pipeline
 *  label      - dashboard column heading
 *  track      - TRACK.ONE_TIME | TRACK.RENEWAL
 *  dateField  - Zoho `Vendors` API name holding the governing date
 *  refField   - Zoho API name of the reference/document number. Used ONLY to
 *               confirm a document exists. NEVER rendered. See PRIVACY below.
 *  fileKeys   - document-classifier keys that evidence this requirement
 *  pdfLabel   - label in the onboarding PDF, for the null-date fallback
 */
const REQUIREMENTS = [
  {
    key: 'ndis_worker_check',
    label: 'NDIS Worker Check',
    track: TRACK.RENEWAL,
    dateField: 'NDIS_WC_Expiry',
    refField: 'NDIS_Worker_Check_National_ID',
    fileKeys: ['ndis_worker_check'],
    pdfLabel: 'Worker Check Expiry',
  },
  {
    key: 'ndis_orientation',
    label: 'NDIS Worker Orientation',
    track: TRACK.ONE_TIME,
    dateField: 'Date_Issued',
    refField: null,
    fileKeys: ['orientation'],
    pdfLabel: 'NDIS Worker Orientation Issue Date',
  },
  {
    key: 'wwcc',
    label: 'WWCC',
    track: TRACK.RENEWAL,
    dateField: 'WWCC_Expiry',
    refField: 'SRN',
    fileKeys: ['wwcc'],
    pdfLabel: 'Working with Children Check Expiry',
  },
  {
    key: 'police_check',
    label: 'Police Check',
    track: TRACK.ONE_TIME,
    dateField: 'Police_Check_Issue_Date',
    refField: null,
    fileKeys: ['police'],
    pdfLabel: 'Police Check Issue Date',
  },
  {
    key: 'infection_control',
    label: 'Infection Control',
    track: TRACK.ONE_TIME,
    dateField: 'Infection_Control_Completion_date',
    refField: null,
    fileKeys: ['infection'],
    pdfLabel: 'Infection Control Completion Date',
  },
  {
    key: 'drivers_licence',
    label: "Driver's Licence",
    track: TRACK.RENEWAL,
    dateField: 'Drivers_License_Expiry',
    refField: 'License_Number',
    fileKeys: ['drivers_licence'],
    pdfLabel: "Driver's License Expiry Date",
  },
  {
    key: 'vehicle_registration',
    label: 'Vehicle Registration',
    track: TRACK.RENEWAL,
    dateField: 'Car_Registration_Expiry',
    refField: 'Plate_Number',
    fileKeys: ['registration'],
    pdfLabel: null,
  },
  {
    key: 'vehicle_insurance',
    label: 'Vehicle Insurance',
    track: TRACK.RENEWAL,
    dateField: 'Insurance_Term_Date',
    refField: 'Car_Insurer',
    fileKeys: ['insurance'],
    pdfLabel: null,
  },
  {
    key: 'first_aid',
    label: 'First Aid',
    track: TRACK.RENEWAL,
    dateField: 'Renewal_Date',
    refField: 'Document_Number',
    fileKeys: ['first_aid'],
    pdfLabel: 'First Aid Renewal Date',
  },
  {
    key: 'cpr',
    label: 'CPR',
    track: TRACK.RENEWAL,
    dateField: 'CPR_Renewal_Date',
    refField: 'CPR_Certificate_Number',
    fileKeys: ['cpr'],
    pdfLabel: null,
  },
];

// Alerting thresholds, in days.
const ALERT_BUCKETS = [30, 60, 90];
const EXPIRING_SOON_DAYS = 90;

// Zoho scope ------------------------------------------------------------------
const STAFF_STATUSES = ['Active', 'Onboarding'];

/**
 * PRIVACY — the only Zoho fields this pipeline may request.
 * Everything else on `Vendors` (TFN, BSB, account, super/SMSF/APRA, DOB,
 * address, emergency contacts) is deliberately excluded and must never be
 * selected, parsed, stored or rendered. Enforced by test/privacy.test.js.
 */
const ZOHO_FIELD_WHITELIST = [
  'id',
  'Vendor_Name',
  'Staff_Last_Name',
  'Staff_Status',
  ...REQUIREMENTS.map((r) => r.dateField),
  // Reference/document numbers (SRN, License_Number, NDIS_Worker_Check_National_ID,
  // Document_Number, CPR_Certificate_Number) are deliberately NOT queried. Evidence
  // files already establish that a document exists, so fetching the numbers would
  // add identifying data for no analytical gain. They remain in REQUIREMENTS[].refField
  // as documentation of where they live in Zoho, and nothing reads them.
];

/** Keys that must never appear in any output object. */
const FORBIDDEN_KEY_PATTERN =
  /tfn|bsb|account|super|smsf|apra|dob|date_of_birth|birth|address|street|suburb|\bcity\b|postcode|zip|emergency|phone|email|biography|member|salutation|gender/i;

/**
 * Records that are test data rather than people.
 *
 * Matches "test" or "testing" as a WHOLE word in either name field, so the
 * Zoho record "Aurelio test" is excluded while genuine names that merely
 * contain the letters (Testa, Contestabile) are not. Excluded records are
 * reported, never dropped silently.
 */
const TEST_RECORD_PATTERN = /(^|[^a-z])test(ing)?([^a-z]|$)/i;

/** Reference fields are used for existence checks only, never rendered. */
const REF_FIELDS = REQUIREMENTS.map((r) => r.refField).filter(Boolean);

module.exports = {
  TEST_RECORD_PATTERN,
  STATUS,
  STATUS_LABEL,
  TRACK,
  REQUIREMENTS,
  ALERT_BUCKETS,
  EXPIRING_SOON_DAYS,
  STAFF_STATUSES,
  ZOHO_FIELD_WHITELIST,
  FORBIDDEN_KEY_PATTERN,
  REF_FIELDS,
};
