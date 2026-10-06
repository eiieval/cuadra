// Formatting and escaping helpers shared by the app, the document renderer and the verification page.
// Pure functions, no DOM: they also run under Node for the tests.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
// The same grouping without the currency sign, for sums written as "180,00 + 37,80 = 217,80 €".
export const dec = (n) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const fmtDate = (iso) => (ISO_DAY.test(String(iso || '')) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T12:00:00`)) : '');
export const isoToday = () => new Date().toLocaleDateString('sv-SE');

// CSV: every cell is quoted, and a cell that starts like a formula gets a quote in front, so a spreadsheet never runs it.
export const csvPlain = (v) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `'${s}` : s; };
export const csvCell = (v) => `"${csvPlain(v).replace(/"/g, '""')}"`;

// Minimal, safe formatting for agent replies: escape first, then only add <b> and bullet glyphs.
export const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^\s*[*-]\s+/gm, '• ').replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:])/g, '$1$2');

// Only PayPal's own pages are ever linked or encoded in a QR code.
export const safeUrl = (u) => (/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(String(u || '')) ? String(u) : null);
