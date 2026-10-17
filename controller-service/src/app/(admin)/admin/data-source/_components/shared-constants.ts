// Mirror of lib/import/jobs.ts STALE_JOB_MESSAGE. Kept here so the Overview tab (a client
// component) does not pull a 'use server'-flavoured module into the client bundle.
export const STALE_JOB_MESSAGE = 'The import stopped before it finished (the worker restarted). Products saved before that are kept; run it again to finish.'
