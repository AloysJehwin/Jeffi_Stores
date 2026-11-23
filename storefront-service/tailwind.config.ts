import path from 'path'
import type { Config } from 'tailwindcss'
import preset from '../packages/store-core/tailwind.preset'

// The code parts' own default classes (lib/site/code) come from this stylesheet: store pages draw them.
const config: Config = {
  presets: [preset],
  content: [
    path.join(__dirname, 'src/**/*.{js,ts,jsx,tsx,mdx}'),
    path.join(__dirname, '../packages/store-core/src/components/**/*.{js,ts,jsx,tsx,mdx}'),
    path.join(__dirname, '../packages/store-core/src/lib/site/code/**/*.{ts,tsx}'),
  ],
}

export default config
