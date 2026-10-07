// The limits of an invoice, in one place: lib/validate.js (the server, the source of truth) and the browser checks
// (checks.js, proposal.js) both read them, so what the page lets you issue is what the server accepts.
export const LIMITS = {
  maxLines: 20,
  maxQty: 10000,
  maxPrice: 100000,
  maxTotal: 1000000, // EUR, VAT included
  maxLineDescription: 200,
  maxDescription: 250,
  maxName: 120,
  maxEmail: 254,
  vatRates: [0, 4, 10, 21],
};
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
