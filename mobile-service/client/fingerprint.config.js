// Reanimated's static feature flags (package.json "reanimated") are compiled into the native app, so a
// change to them needs a store build, not an OTA update.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  extraSources: [
    {
      type: 'contents',
      id: 'reanimated-static-feature-flags',
      contents: JSON.stringify(require('./package.json').reanimated ?? {}),
      reasons: ['reanimatedStaticFeatureFlags'],
    },
  ],
}
