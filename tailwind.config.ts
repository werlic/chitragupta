import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

// Lontar "Nila" accent scale (600 = primary #3B3FB6)
const nila = {
  50: '#F4F4FD', 100: '#ECECFB', 200: '#D6D7F6', 300: '#B4B6EE', 400: '#8A8FF0', 500: '#5A5ED0',
  600: '#3B3FB6', 700: '#2E3192', 800: '#262877', 900: '#20225F', 950: '#15163D',
};

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Older screens still use raw palette classes; point them at Lontar until each is redone
        nila,
        // Raw canvas values (docs/design/r1-canvas/*.dc.html inline styles)
        lontar: {
          bg: '#FAF8F5',
          muted: '#F2EFEA',
          head: '#FBF9F6',
          active: '#E9E4DC',
          border: '#E4DFD7',
          line: '#EEEAE3',
          input: '#D9D3C9',
          sep: '#C9C2B7',
          text: '#1C1A17',
          sub: '#4A453E',
          mute: '#6B655C',
          clarifyLine: '#F0C6F7',
          warnLine: '#F6D58E',
          warnBg: '#FFFBEB',
          dangerLine: '#F3C4C4',
          rejectLine: '#E3B3B3',
          disabled: '#C5C6EC',
        },
        indigo: nila,
        violet: nila,
        purple: nila,
        blue: colors.sky,
        emerald: colors.green,
        slate: colors.stone,
        gray: colors.stone,
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          soft: 'hsl(var(--destructive-soft))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          soft: 'hsl(var(--success-soft))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          soft: 'hsl(var(--warning-soft))',
        },
        clarify: {
          DEFAULT: 'hsl(var(--clarify))',
          foreground: 'hsl(var(--clarify-foreground))',
          soft: 'hsl(var(--clarify-soft))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          soft: 'hsl(var(--info-soft))',
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 6px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'slide-in': {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
