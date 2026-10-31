// Client-safe shapes for server-side conversion uploads (the Conversions tab and its APIs).

export type ConversionKind = 'purchase' | 'retraction' | 'restatement'
export type UploadStatus = 'pending' | 'uploaded' | 'failed' | 'skipped'

export const UPLOAD_STATUSES: UploadStatus[] = ['pending', 'uploaded', 'failed', 'skipped']
export const CONVERSION_KINDS: ConversionKind[] = ['purchase', 'retraction', 'restatement']

export const SERVER_ACTION_NAME = 'Purchase (server)'

/** data_manager: Data Manager API (default). ads_api: Google Ads API uploadClickConversions, for allowlisted tokens. */
export type UploadApi = 'data_manager' | 'ads_api'
export const UPLOAD_APIS: UploadApi[] = ['data_manager', 'ads_api']

/** Google's processing status of one Data Manager request; UNKNOWN / TIMED_OUT when it never said. */
export type RequestStatus = 'PROCESSING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'UNKNOWN' | 'TIMED_OUT'

export interface ReasonCount {
  reason: string
  count: number
}

export interface DataManagerRequest {
  requestId: string
  kind: 'purchase' | 'adjustment'
  events: number
  status: RequestStatus
  recordCount: number | null
  errors: ReasonCount[]
  warnings: ReasonCount[]
  fieldWarnings: { field: string; reason: string; description: string }[]
  checks: number
  createdAt: string
  lastCheckedAt: string | null
  finishedAt: string | null
  /** Last problem reading the status (not a processing error). */
  error: string | null
}

/**
 * Whether the connection's credentials can use the Data Manager API: granted / missing for a
 * Google sign-in, unknown for a hand-entered token, and the platform's own credentials otherwise.
 */
export type DataManagerAccess = 'granted' | 'missing' | 'unknown' | 'service_account' | 'manager' | 'not_connected'

export interface ConversionAuth {
  connectedVia: 'oauth' | 'manual' | 'manager' | 'platform' | null
  dataManager: DataManagerAccess
}

export interface SetupCheck {
  ok: boolean
  code: string | null
  message: string
  warnings: { field: string; reason: string; description: string }[]
}

export interface UploadRunSummary {
  status: 'success' | 'partial' | 'error' | 'not_configured' | 'idle'
  uploaded: number
  failed: number
  retrying: number
  skipped: number
  enqueued: number
  /** Request-level problem (auth, quota, not allowlisted), when one stopped the run. */
  error: string | null
  errorCode: string | null
  identifiers: boolean
  finishedAt: string
  api?: UploadApi
  /** Data Manager ingest requests Google accepted this run. */
  requests?: number
  /** Data Manager request statuses read this run. */
  checked?: number
}

export interface ConversionConfig {
  action: string | null
  actionName: string | null
  owner: string | null
  account: string | null
  setAt: string | null
  /** The connected customer, from the last sync or the choice itself. */
  connectedCustomer: string | null
  /** False when the account was changed after the action was chosen; uploads pause until re-chosen. */
  matchesAccount: boolean
  lastRunAt: string | null
  lastRun: UploadRunSummary | null
  uploadApi: UploadApi
}

export interface ConversionsSummary {
  /** False until the queue table exists on this store's database. */
  available: boolean
  range: { from: string; to: string }
  config: ConversionConfig
  /** Rows created in the range, by status. */
  counts: Record<UploadStatus, number>
  /** Purchase value uploaded in the range (after folding restatements). */
  uploadedValue: number
  byKind: { kind: ConversionKind; status: UploadStatus; n: number }[]
  /** Everything waiting or stuck, regardless of range. */
  backlog: { pending: number; failed: number }
  /** The Google tag's purchase conversion is set in Site Controls (risk of counting twice). */
  browserConversion: boolean
  auth: ConversionAuth
}

export interface UploadRow {
  id: number
  order_id: string
  order_number: string
  kind: ConversionKind
  version: number
  value: number
  currency_code: string
  status: UploadStatus
  attempts: number
  next_attempt_at: string | null
  error_code: string | null
  error: string | null
  uploaded_at: string | null
  created_at: string
  conversion_at: string
  click: 'gclid' | 'gbraid' | 'wbraid' | null
  ads_consent: boolean | null
  request_id: string | null
  /** Google's processing status of the Data Manager request that sent it. */
  request_status: RequestStatus | null
  request_errors: ReasonCount[] | null
  request_events: number | null
}

export interface UploadLog {
  rows: UploadRow[]
  total: number
  page: number
  pageSize: number
}

export interface GoogleConversionAction {
  resourceName: string
  id: string
  name: string
  type: string | null
  status: string | null
  category: string | null
  primaryForGoal: boolean | null
  countingType: string | null
  /** Customer id that owns it (a manager under cross-account conversion tracking). */
  owner: string | null
  origin: string | null
  lookbackDays: number | null
  defaultCurrency: string | null
  alwaysUseDefaultValue: boolean | null
}

export interface ConversionTrackingSettings {
  conversionCustomer: string | null
  trackingStatus: string | null
  acceptedCustomerDataTerms: boolean | null
  enhancedConversions: string | null
}

export interface OfflineSummaryCounts {
  key: string
  successful: number
  failed: number
  pending: number
}

export interface OfflineDiagnostics {
  scope: 'account' | 'action'
  client: string | null
  actionName: string | null
  status: string | null
  total: number
  successful: number
  pending: number
  successRate: number | null
  lastUpload: string | null
  alerts: { error: string; percent: number | null }[]
  daily: OfflineSummaryCounts[]
  jobs: OfflineSummaryCounts[]
}

export interface GoogleConversionsData {
  actions: GoogleConversionAction[]
  settings: ConversionTrackingSettings | null
  diagnostics: OfflineDiagnostics[]
  errors: { step: string; message: string }[]
}
