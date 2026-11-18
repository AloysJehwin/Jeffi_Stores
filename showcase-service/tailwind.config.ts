import path from 'path'
import type { Config } from 'tailwindcss'
import preset from '../packages/store-core/tailwind.preset'

// The page's sections bring their own compiled CSS; the code parts they render (lib/site/code/parts) and the shared
// components use the app stylesheet's classes.
const config: Config = {
  presets: [preset],
  content: [
    path.join(__dirname, 'src/**/*.{js,ts,jsx,tsx,mdx}'),
    path.join(__dirname, '../packages/store-core/src/components/**/*.{js,ts,jsx,tsx,mdx}'),
    path.join(__dirname, '../packages/store-core/src/lib/site/code/**/*.{ts,tsx}'),
  ],
}

export default config
