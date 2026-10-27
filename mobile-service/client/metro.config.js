const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)
// packages/design-tokens and packages/api-contracts (product sorts) sit outside this project (shared with the web app); let Metro see them.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, '../../packages/design-tokens'),
  path.resolve(__dirname, '../../packages/api-contracts'),
]

// inlineRem 16 = the browser root size, so text-sm / p-4 etc. match the storefront's pixel sizes.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 })
