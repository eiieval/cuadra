// Verification page: reads the record from the fragment of the URL, rebuilds it, re-hashes it in this browser and shows
// the printable document. The record is never sent anywhere: the fragment never leaves the browser. The one request this
// page makes is GET /api/attest, for the public key that checks the deployment's signature (nothing about the record travels).
import { decodeRecord, fragmentValue, ShareError, verifyRecord } from './js/share.js';
import { renderDocument } from './js/document.js';
import { qrSvg } from './js/qr.js';
import { esc } from './js/fmt.js';
import { verdictHtml, attestHtml } from './js/verdict.js';
import { checkAttestation, fetchAttestKey } from './js/attest.js';

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
  $('#attest').hidden = true;
  let rec;
  try {
    rec = await decodeRecord(fragmentValue(location.hash));
  } catch (e) {
    paper.replaceChildren();
    return verdict('info', esc(MESSAGES[e instanceof ShareError ? e.code : 'malformed']));
  }
  const [v, key] = await Promise.all([verifyRecord(rec), fetchAttestKey()]);
  const signed = v.ok && !rec.kind ? await checkAttestation(rec, key) : null;
  const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  paper.innerHTML = renderDocument(rec, { qr: qrSvg, stamp: v.ok ? '' : 'Altered', check: { ok: v.ok, at: when }, attest: signed });
  paper.hidden = false;
  $('#print').disabled = false;
  document.title = `${rec.kind === 'anulacion' ? 'Cancellation' : 'Invoice'} ${rec.number} · Cuadra verification`;
  const out = verdictHtml(v);
  verdict(out.state, out.html);
  const line = $('#attest');
  line.hidden = !signed;
  if (signed) { const a = attestHtml(signed); line.dataset.state = a.state; line.innerHTML = a.html; }
}

$('#print').addEventListener('click', () => window.print());
window.addEventListener('hashchange', show);
show();
