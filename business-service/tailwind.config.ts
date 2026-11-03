import path from 'path'
import type { Config } from 'tailwindcss'
import preset from '../packages/store-core/tailwind.preset'

const config: Config = {
  presets: [preset],
  content: [
    path.join(__dirname, 'src/**/*.{js,ts,jsx,tsx,mdx}'),
    path.join(__dirname, '../packages/store-core/src/components/**/*.{js,ts,jsx,tsx,mdx}'),
  ],
}

export default config
