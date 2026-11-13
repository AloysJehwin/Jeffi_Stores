import * as Application from 'expo-application'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'

// Which build this is: the store version (versionName), Play's build number (versionCode, bumped by EAS on
// every native build) and the over-the-air update running on top of it.

export interface AppVersion {
  version: string
  build: string | null
  /** First 8 chars of the running EAS Update id; null on the binary's embedded bundle. */
  update: string | null
}

export function appVersion(): AppVersion {
  const update = !Updates.isEmbeddedLaunch && Updates.updateId ? Updates.updateId.replace(/-/g, '').slice(0, 8) : null
  return {
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0',
    build: Application.nativeBuildVersion ?? null,
    update,
  }
}

/** "1.0.0 (23)", plus "· u1a2b3c4d" when an OTA update is running. Fits push_devices.app_version (40). */
export function appVersionLabel(v: AppVersion = appVersion()): string {
  return `${v.version}${v.build ? ` (${v.build})` : ''}${v.update ? ` · u${v.update}` : ''}`.slice(0, 40)
}
