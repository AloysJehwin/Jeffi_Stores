const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)
// packages/design-tokens sits outside this project (shared with the web app); let Metro see it.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../packages/design-tokens')]

module.exports = withNativeWind(config, { input: './global.css' })
