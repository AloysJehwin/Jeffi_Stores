// Android 11+ package visibility: lets Linking.canOpenURL see the UPI apps the checkout offers (app/checkout/upi.tsx).
const { withAndroidManifest } = require('expo/config-plugins')

const SCHEMES = ['upi', 'tez', 'phonepe', 'paytmmp']

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest
    const queries = manifest.queries?.[0] ?? {}
    const intents = queries.intent ?? []
    const declared = new Set(intents.flatMap(i => (i.data ?? []).map(d => d.$?.['android:scheme'])))
    for (const scheme of SCHEMES) {
      if (declared.has(scheme)) continue
      intents.push({ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': scheme } }] })
    }
    manifest.queries = [{ ...queries, intent: intents }]
    return cfg
  })
}
