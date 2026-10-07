// Verification page: reads the record from the fragment of the URL, rebuilds it, re-hashes it in this browser and shows
// the printable document. Nothing is sent anywhere: the fragment never leaves the browser, there is no fetch here.
import { decodeRecord, fragmentValue, ShareError, verifyRecord } from './js/share.js';
import { renderDocument } from './js/document.js';
import { qrSvg } from './js/qr.js';
import { esc } from './js/fmt.js';
import { verdictHtml } from './js/verdict.js';

const $ = (s) => document.querySelector(s);
const MESSAGES = {
  empty: 'This link carries no document. Open it from the invoice in Cuadra ("Copy verification link").',
  'too-large': 'This link is too large to be an invoice record, so it was not opened.',
  malformed: 'This link cannot be read: it looks damaged or incomplete.',
  unsupported: 'This browser cannot open compressed links. Try a current version of Chrome, Edge, Firefox or Safari.',
};

function verdict(state, html) {
  const el = $('#verdict');
  el.dataset.state = state;
  el.innerHTML = html;
}

async function show() {
  const paper = $('#paper');
  paper.hidden = true;
  $('#print').disabled = true;
  verdict('checking', 'Checking the record…');
  let rec;
  try {
    rec = await decodeRecord(fragmentValue(location.hash));
  } catch (e) {
    paper.replaceChildren();
    return verdict('info', esc(MESSAGES[e instanceof ShareError ? e.code : 'malformed']));
  }
  const v = await verifyRecord(rec);
  const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  paper.innerHTML = renderDocument(rec, { qr: qrSvg, stamp: v.ok ? '' : 'Altered', check: { ok: v.ok, at: when } });
  paper.hidden = false;
  $('#print').disabled = false;
  document.title = `${rec.kind === 'anulacion' ? 'Cancellation' : 'Invoice'} ${rec.number} · Cuadra verification`;
  const out = verdictHtml(v);
  verdict(out.state, out.html);
}

$('#print').addEventListener('click', () => window.print());
window.addEventListener('hashchange', show);
show();
