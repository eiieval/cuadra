// Tailwind is compiled at build time (npm run build:css) so no third-party script runs in the browser.
// The named colors mirror the tokens in the :root block of styles/input.css; scripts/ui-test.js checks that they agree.
module.exports = {
  content: ['./public/index.html', './public/verify.html', './public/app.js', './public/verify.js', './public/js/*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0d14',
        surface: { DEFAULT: '#10141f', 2: '#161b29' },
        line: 'rgba(255,255,255,.08)',
        fg: '#e8ecf4',
        soft: '#94a3b8',
        ok: '#34d399',
        warn: '#fbbf24',
        bad: '#fb7185',
        link: '#a5b4fc',
        paper: { DEFAULT: '#f7f6f1', ink: '#151a26', soft: '#566075' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Instrument Serif is deliberately not a utility: it only exists in .brand-line (styles/input.css).
      },
    },
  },
  plugins: [],
};
