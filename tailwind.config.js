/** @type {import('tailwindcss').Config} */
const brandColors = {
  yellow: '#FDBA12',
  black: '#05070D',
  carbon: '#151518',
  red: '#F4143E',
  orange: '#F3833F',
  white: '#FFFFFF',
  surface: '#111827',
  surface2: '#1A2235',
  border: '#1E2D42',
  muted: '#64748B',
  text: '#E2E8F0',
  textStrong: '#F8FAFC',
  appBg: '#0A0E1A',
}

module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        mercosur: brandColors,
        success: '#10B981',
        warning: '#F59E0B',
        error: '#DC2626',
        info: '#2563EB',
      },
      fontFamily: {
        brand: ['Mulish', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        display: ['Syne', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
