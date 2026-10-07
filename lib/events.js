// Demo-grade store of verified PayPal webhook events: the last MAX_EVENTS in the memory of the function instance,
// deduplicated by event_id. Production would write these to a server-side ledger instead (see the README, "Webhooks").
export const MAX_EVENTS = 200;

const events = [];
const seen = new Set();

// What an event says about an invoice, reduced to what the app needs. Unknown shapes give an event without an invoice id.
const STATUS_OF = {
  'INVOICING.INVOICE.PAID': 'PAID',
  'INVOICING.INVOICE.CANCELLED': 'CANCELLED',
  'INVOICING.INVOICE.REFUNDED': 'REFUNDED',
  'INVOICING.INVOICE.UPDATED': null,
  'INVOICING.INVOICE.CREATED': null,
};
const INVOICE_ID = /^INV2-[A-Z0-9-]{4,40}$/;
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export function summarize(event) {
  const type = text(event?.event_type, 60);
  const r = event?.resource || {};
  const candidate = text(r.invoice?.id || r.id || r.invoice_id, 60);
  const fromResource = text(r.invoice?.status || r.status, 30).toUpperCase().replace(/[^A-Z_]/g, '');
  return {
    id: text(event?.id, 80),
    type,
    invoiceId: INVOICE_ID.test(candidate) ? candidate : '',
    status: STATUS_OF[type] ?? (fromResource || ''),
    at: Number.isFinite(Date.parse(event?.create_time)) ? new Date(event.create_time).toISOString() : new Date().toISOString(),
  };
}

// Stores a verified event. Returns { stored, duplicate }.
export function record(event) {
  const e = summarize(event);
  if (!e.id) return { stored: false, duplicate: false };
  if (seen.has(e.id)) return { stored: false, duplicate: true };
  seen.add(e.id);
  events.push(e);
  while (events.length > MAX_EVENTS) seen.delete(events.shift().id);
  return { stored: true, duplicate: false };
}

// Events for the given invoice ids, oldest first.
export const eventsFor = (ids) => {
  const want = new Set(ids);
  return events.filter((e) => e.invoiceId && want.has(e.invoiceId)).map(({ id, ...rest }) => rest);
};

export const size = () => events.length;
export const clear = () => { events.length = 0; seen.clear(); };
