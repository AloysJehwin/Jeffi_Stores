module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        accent: {
          50:  '#f2f7e8',
          100: '#e4f0d1',
          200: '#c9e1a3',
          300: '#aed275',
          400: '#93c347',
          500: '#7cb900',
          600: '#5a8a00',
          700: '#3d5e00',
          800: '#203200',
          900: '#2b4200',
        },
        secondary: {
          500: '#363948',
        },
      },
      fontFamily: {
        bebas: ['BebasNeue-Regular'],
        inter: ['Inter'],
      },
    },
  },
  plugins: [],
}
