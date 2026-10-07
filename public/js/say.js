// The agent's sentence when the model answers with proposals and no text (Gemini Flash-Lite often does). It is written
// here, in the browser, from the proposals themselves and from the ledger, so every figure in it comes from the engine
// (totals(), widgetData()), never from the model. Pure: no DOM, no network. English and Spanish.
import { totals } from './verifactu.js';
import { findInvoice, returnQuarter } from './ledger.js';
import { eur } from './fmt.js';
import { normalizeProposal, normalizeRectify } from './proposal.js';
import { countText, widgetData } from './widgets.js';
import { cleanView, viewSummary } from './view.js';

// "es" when the person wrote in Spanish: accents and a few words that English does not share.
export const detectLang = (text) => (/[¿¡áéíóúñü]|\b(factura|facturas|cierra|cierre|trimestre|debe|deben|cuánto|cuanto|quién|quien|dame|ingresos|cliente|clientes|pagó|pagado|este|mes|año)\b/i.test(String(text ?? '')) ? 'es' : 'en');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (parts, and) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} ${and} ${parts.at(-1)}`);
const qtyText = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(Number(n) || 0);

const WORDS = {
  en: {
    and: 'and',
    method: { BANK_TRANSFER: 'bank transfer', CASH: 'cash', OTHER: 'other method' },
    invoice: (client, total, how) => `Invoice draft for ${client}: ${total} (${how})`,
    lineOne: (qty, price, vat) => `${qty} × ${price}${vat === 'none' ? ', VAT exempt' : ' + VAT'}`,
    lineMany: (n, exempt) => `${n} lines${exempt ? ', VAT exempt' : ' + VAT'}`,
    reminder: (client, number, amount) => `Payment reminder for ${client} (${number}, ${amount}).`,
    collect: (client, number, amount) => `Send ${number} (${client}, ${amount}) with PayPal so the client can pay online.`,
    markPaid: (client, number, amount, how) => `Record the ${how} payment of ${number} (${client}, ${amount}).`,
    cancel: (client, number, amount) => `Cancel ${number} (${client}, ${amount}) with a chained cancellation record.`,
    rectify: (client, number, amount, total) => `Corrective invoice for ${number} (${client}): ${amount} becomes ${total}. The paid invoice stays as it is.`,
    vat: (quarter) => `Your Modelo 303 draft for ${quarter}.`,
    view: (title, how) => `View: ${title} (${how}). Apply it to the ledger.`,
    owes: (count, total) => `Here is who owes you money: ${count}, ${total}`,
    widget: (title, count, total) => `${title}: ${count ? `${count}, ` : ''}${total}`,
    planClose: 'Plan to close the quarter',
    plan: 'Plan',
    parts: {
      reminder: (n) => plural(n, 'reminder'), collect: (n) => `${plural(n, 'collection')} with PayPal`, invoice: (n) => plural(n, 'invoice draft'),
      view: (n) => plural(n, 'ledger view'),
      markPaid: (n) => `${plural(n, 'payment')} to record`, cancel: (n) => plural(n, 'cancellation'), rectify: (n) => plural(n, 'corrective invoice'), widget: (n) => plural(n, 'insight'), vat: 'your VAT draft',
    },
    count: (data) => countText(data),
    unknown: 'Here is my proposal. Review it and confirm.',
  },
  es: {
    and: 'y',
    method: { BANK_TRANSFER: 'transferencia', CASH: 'efectivo', OTHER: 'otro método' },
    invoice: (client, total, how) => `Borrador de factura para ${client}: ${total} (${how})`,
    lineOne: (qty, price, vat) => `${qty} × ${price}${vat === 'none' ? ', exenta de IVA' : ' + IVA'}`,
    lineMany: (n, exempt) => `${n} líneas${exempt ? ', exentas de IVA' : ' + IVA'}`,
    reminder: (client, number, amount) => `Recordatorio de pago para ${client} (${number}, ${amount}).`,
    collect: (client, number, amount) => `Enviar ${number} (${client}, ${amount}) por PayPal para que el cliente pague online.`,
    markPaid: (client, number, amount, how) => `Registrar el pago por ${how} de ${number} (${client}, ${amount}).`,
    cancel: (client, number, amount) => `Anular ${number} (${client}, ${amount}) con un registro de anulación encadenado.`,
    rectify: (client, number, amount, total) => `Factura rectificativa de ${number} (${client}): de ${amount} a ${total}. La factura cobrada no se modifica.`,
    vat: (quarter) => `Tu borrador del Modelo 303 de ${quarter}.`,
    view: (title, how) => `Vista: ${title} (${how}). Aplícala al libro.`,
    owes: (count, total) => `Esto es lo que te deben: ${count}, ${total}`,
    widget: (title, count, total) => `${title}: ${count ? `${count}, ` : ''}${total}`,
    planClose: 'Plan para cerrar el trimestre',
    plan: 'Plan',
    parts: {
      reminder: (n) => plural(n, 'recordatorio'), collect: (n) => `${plural(n, 'cobro')} con PayPal`, invoice: (n) => plural(n, 'borrador de factura', 'borradores de factura'),
      view: (n) => plural(n, 'vista del libro', 'vistas del libro'),
      markPaid: (n) => `${plural(n, 'pago')} por registrar`, cancel: (n) => plural(n, 'anulación', 'anulaciones'), rectify: (n) => plural(n, 'factura rectificativa', 'facturas rectificativas'), widget: (n) => plural(n, 'gráfico'), vat: 'tu borrador del IVA',
    },
    count: (data) => {
      const n = data.n;
      const noun = data.spec.metric === 'outstanding' ? ['factura pendiente', 'facturas pendientes'] : data.spec.metric === 'collected' ? ['factura cobrada', 'facturas cobradas'] : ['factura', 'facturas'];
      return `${n} ${n === 1 ? noun[0] : noun[1]}`;
    },
    unknown: 'Aquí tienes mi propuesta. Revísala y confirma.',
  },
};

// One proposal in one sentence. ctx: { records, today, lang }.
function one(a, w, { records, today }) {
  const inv = (number) => findInvoice(records, number);
  const who = (r) => r?.recipient?.name || '';
  switch (a.type) {
    case 'propose_invoice': {
      const p = normalizeProposal(a.args);
      const lines = p.lines;
      const how = lines.length === 1 ? w.lineOne(qtyText(lines[0].qty), eur(lines[0].price), lines[0].vat === 0 ? 'none' : 'vat') : w.lineMany(lines.length, lines.every((l) => l.vat === 0));
      return w.invoice(p.recipient.name, eur(totals(lines).total), how);
    }
    case 'propose_reminder': { const r = inv(a.args?.number); return w.reminder(who(r) || a.args?.number, a.args?.number, eur(r?.total)); }
    case 'propose_collect': { const r = inv(a.args?.number); return w.collect(who(r) || a.args?.number, a.args?.number, eur(r?.total)); }
    case 'propose_mark_paid': { const r = inv(a.args?.number); return w.markPaid(who(r) || a.args?.number, a.args?.number, eur(r?.total), w.method[a.args?.method] || w.method.BANK_TRANSFER); }
    case 'propose_cancel': { const r = inv(a.args?.number); return w.cancel(who(r) || a.args?.number, a.args?.number, eur(r?.total)); }
    case 'propose_rectify': { const r = inv(a.args?.number); return w.rectify(who(r) || a.args?.number, a.args?.number, eur(r?.total), eur(totals(normalizeRectify(a.args).lines).total)); }
    case 'show_vat_return': return w.vat(/^\d{4}-Q[1-4]$/.test(a.args?.quarter || '') ? a.args.quarter : returnQuarter(today));
    case 'propose_view': { const v = cleanView(a.args); return w.view(v.title, viewSummary(v)); }
    case 'propose_widget': {
      const d = widgetData(records, a.args, today);
      if (d.spec.metric === 'outstanding' && d.spec.groupBy === 'client' && !d.spec.status) return w.owes(w.count(d), d.text);
      return w.widget(d.title, d.spec.metric === 'count' ? '' : w.count(d), d.text);
    }
    default: return '';
  }
}

// actions: the proposals of the reply (at least one). Returns the sentence, or '' if nothing can be said about them.
export function synthReply(actions, { records = [], today, lang = 'en' } = {}) {
  const w = WORDS[lang] || WORDS.en;
  const list_ = (Array.isArray(actions) ? actions : []).filter((a) => a && typeof a.type === 'string');
  if (!list_.length) return '';
  if (list_.length === 1) return one(list_[0], w, { records, today }) || w.unknown;
  const count = (type) => list_.filter((a) => a.type === type).length;
  const parts = [
    count('propose_reminder') && w.parts.reminder(count('propose_reminder')),
    count('propose_collect') && w.parts.collect(count('propose_collect')),
    count('propose_invoice') && w.parts.invoice(count('propose_invoice')),
    count('propose_mark_paid') && w.parts.markPaid(count('propose_mark_paid')),
    count('propose_cancel') && w.parts.cancel(count('propose_cancel')),
    count('propose_rectify') && w.parts.rectify(count('propose_rectify')),
    count('propose_widget') && w.parts.widget(count('propose_widget')),
    count('propose_view') && w.parts.view(count('propose_view')),
    count('show_vat_return') && w.parts.vat,
  ].filter(Boolean);
  const closing = count('show_vat_return') && (count('propose_reminder') || count('propose_collect'));
  return `${closing ? w.planClose : w.plan}: ${list(parts, w.and)}.`;
}
