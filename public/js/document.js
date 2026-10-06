// The one renderer of the invoice document, used by the detail dialog of the app and by public/verify.html.
// Bilingual labels ("Factura / Invoice"), issuer, client, lines, VAT breakdown, total, two QR codes and the hash
// footer. Every field is escaped; the AEAT QR is rebuilt from the hashed fields and the PayPal QR only exists for a
// payer link that passes safeUrl(), so a hostile record cannot make the page show or encode anything else.
import { isAnulacion, money, qrUrl } from './verifactu.js';
import { esc, eur, fmtDate, safeUrl } from './fmt.js';

const num = (v) => `<span class="num">${esc(v)}</span>`;

function qrFigure(svg, title, hint) {
  return `<figure class="doc-qr"><div class="doc-qr-img">${svg || '<div class="doc-qr-missing">QR unavailable</div>'}</div><figcaption><b>${esc(title)}</b>${hint ? `<br>${esc(hint)}` : ''}</figcaption></figure>`;
}

const chainFoot = (r, check) => `<footer class="doc-foot-text">
  <div><span class="doc-label">Hash SHA-256</span><div class="num doc-hash">${esc(r.hash)}</div></div>
  <div><span class="doc-label">Registro anterior / Previous record</span><div class="num doc-hash">${r.prev ? esc(`${r.prev.number} · ${r.prev.hash}`) : 'Primer registro de la cadena / First record in the chain'}</div></div>
  <div><span class="doc-label">Generado / Generated</span><div class="num doc-hash">${esc(r.generatedAt)}</div></div>
  ${check ? `<div class="doc-check ${check.ok ? 'is-ok' : 'is-bad'}">${check.ok ? 'Hash check in the browser: matches' : 'Hash check in the browser: DOES NOT MATCH'}${check.at ? ` · ${esc(check.at)}` : ''}</div>` : ''}
</footer>`;

// r: a record (live from the ledger, or rebuilt by share.js). opts.qr: text -> SVG string. opts.stamp: a word printed
// across the document ("CANCELLED", "ALTERED"). opts.check: { ok, at } adds the hash-check line to the footer.
export function renderDocument(r, { qr = () => '', stamp = '', check = null } = {}) {
  const stampHtml = stamp ? `<div class="doc-stamp" aria-hidden="true">${esc(stamp)}</div>` : '';
  if (isAnulacion(r)) {
    return `<article class="doc" aria-label="Cancellation record of ${esc(r.number)}">${stampHtml}
      <header class="doc-head">
        <div><div class="doc-name">${esc(r.issuerName)}</div><div class="doc-meta">NIF ${num(r.nif)}</div></div>
        <div class="doc-id"><div class="doc-title">Anulación / Cancellation record</div><div class="doc-meta">Fecha / Date ${num(r.date)}</div></div>
      </header>
      <section class="doc-party"><div class="doc-label">Factura anulada / Cancelled invoice</div><div class="doc-name num">${esc(r.number)}</div><div class="doc-meta">Issued ${num(r.date)} by NIF ${num(r.nif)}</div>${r.reason ? `<div class="doc-meta">Motivo / Reason: ${esc(r.reason)}</div>` : ''}</section>
      <p class="doc-note">A RegistroAnulacion identifies the cancelled invoice and is chained like any other record. The original invoice stays in the ledger untouched.</p>
      ${chainFoot(r, check)}
    </article>`;
  }
  const lines = (r.lines || []).map((l) => `<tr><td>${esc(l.description)}</td><td class="num text-right">${esc(l.qty)}</td><td class="num text-right">${eur(l.price)}</td><td class="num text-right">${esc(l.vat)} %</td><td class="num text-right">${eur(Number(money(l.qty * l.price)))}</td></tr>`).join('');
  const sums = (r.breakdown || []).map((b) => `<div class="doc-row"><span>Base imponible / Taxable base ${esc(b.rate)} %</span>${num(eur(b.base))}</div><div class="doc-row"><span>IVA / VAT ${esc(b.rate)} %</span>${num(eur(b.tax))}</div>`).join('');
  const payer = safeUrl(r.payerUrl ?? r.paypal?.payerUrl);
  return `<article class="doc" aria-label="Invoice ${esc(r.number)}">${stampHtml}
    <header class="doc-head">
      <div><div class="doc-name">${esc(r.issuerName)}</div><div class="doc-meta">NIF ${num(r.nif)}</div></div>
      <div class="doc-id">
        <div class="doc-title">Factura / Invoice</div>
        <div class="doc-number num">${esc(r.number)}</div>
        <div class="doc-meta">Fecha / Date ${num(r.date)}</div>
        ${r.dueDate ? `<div class="doc-meta">Vencimiento / Due ${num(fmtDate(r.dueDate) || r.dueDate)}</div>` : ''}
      </div>
    </header>
    <section class="doc-party"><div class="doc-label">Cliente / Bill to</div><div class="doc-name">${esc(r.recipient?.name)}</div>${r.recipient?.nif ? `<div class="doc-meta">NIF ${num(r.recipient.nif)}</div>` : ''}</section>
    <div class="doc-scroll"><table class="doc-lines">
      <thead><tr><th>Descripción / Description</th><th class="text-right">Cant. / Qty</th><th class="text-right">Precio / Price</th><th class="text-right">IVA / VAT</th><th class="text-right">Importe / Amount</th></tr></thead>
      <tbody>${lines}</tbody>
    </table></div>
    <section class="doc-totals">${sums}<div class="doc-row doc-total"><span>Total</span>${num(eur(r.total))}</div></section>
    <footer class="doc-foot">
      ${qrFigure(qr(qrUrl(r)), 'Verify at AEAT', 'VERI*FACTU')}
      ${payer ? qrFigure(qr(payer), 'Pay with PayPal', 'Scan to pay online') : ''}
      <p class="doc-note">Invoice verifiable at the Spanish Tax Agency (AEAT test service). Scan the first QR code to check it.</p>
    </footer>
    ${chainFoot(r, check)}
  </article>`;
}
