// Tailwind is compiled at build time (npm run build:css) so no third-party script runs in the browser.
module.exports = { content: ['./public/index.html', './public/app.js'], theme: { extend: {} }, plugins: [] };
