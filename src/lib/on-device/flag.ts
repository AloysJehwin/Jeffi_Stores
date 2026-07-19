/**
 * Feature flag for the on-device (browser-run) checkout summary.
 *
 * Follows the project's client-flag convention (see NEXT_PUBLIC_ENABLE_RAZORPAY):
 * a NEXT_PUBLIC_* env var so the flag is readable in client components AND in the
 * Web Worker, with no DB round-trip. When OFF, nothing about the feature runs —
 * no capability probe, no model download, no session tracking, no UI.
 *
 * Enable by setting in the environment:  NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY=true
 */
export function isOnDeviceSummaryEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY
  return v === 'true' || v === '1'
}
