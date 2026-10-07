// Verification links: an issued record travels in the fragment of a URL (the part after #, which browsers never
// send to a server), is rebuilt and re-hashed by public/verify.html, and is shown as a printable document.
//   #r=z.<base64url of deflate-raw JSON>   compressed (CompressionStream), or
//   #r=j.<base64url of JSON>               plain, when the browser cannot compress
// Everything that comes out of a link is untrusted: decodeRecord() rebuilds a record from a whitelist of fields
// with strict types and sizes, and nothing from the link is ever used as HTML, a URL or a hash without a check.
import { hashInput, isAnulacion, sha256Hex, totals } from './verifactu.js';
import { safeUrl } from './fmt.js';

export const MAX_FRAGMENT = 16 * 1024; // characters of the link value
export const MAX_JSON = 16 * 1024; // bytes of JSON once decoded

export class ShareError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // empty | too-large | malformed | unsupported
  }
}

// The fields a client needs to read and check the document. No PayPal token, no client email, no QR (it is recomputed).
export function shareable(r) {
  const base = {
    nif: r.nif, number: r.number, date: r.date, generatedAt: r.generatedAt, prevHash: r.prevHash || '', hash: r.hash, issuerName: r.issuerName,
    prev: r.prev ? { nif: r.prev.nif, number: r.prev.number, date: r.prev.date, hash: r.prev.hash } : null,
  };
  if (isAnulacion(r)) return { ...base, kind: 'anulacion', reason: r.reason || '' };
  const payer = safeUrl(r.paypal?.payerUrl);
  return {
    ...base,
    type: r.type, taxTotal: r.taxTotal, total: r.total,
    recipient: { name: r.recipient?.name || '', nif: r.recipient?.nif || '' },
    description: r.description || '',
    lines: (r.lines || []).map((l) => ({ description: l.description, qty: l.qty, price: l.price, vat: l.vat })),
    breakdown: (r.breakdown || []).map((b) => ({ rate: b.rate, base: b.base, tax: b.tax })),
    ...(r.dueDate ? { dueDate: r.dueDate } : {}),
    ...(r.rectifies ? { rectifies: { nif: r.rectifies.nif, number: r.rectifies.number, date: r.rectifies.date }, tipoRectificativa: r.tipoRectificativa || 'S', rectified: { base: r.rectified?.base, tax: r.rectified?.tax }, reason: r.reason || '' } : {}),
    ...(payer ? { payerUrl: payer } : {}),
  };
}

const HEX64 = /^[0-9A-Fa-f]{64}$/;
const DMY = /^\d{2}-\d{2}-\d{4}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,12}\.\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
const RATES = [0, 4, 10, 21];
const bad = () => new ShareError('malformed');
const str = (v, max, { min = 0, re } = {}) => {
  if (typeof v !== 'string' || v.length > max || v.length < min || (re && !re.test(v))) throw bad();
  return v;
};
const amount = (v, max) => {
  const n = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(n) || n <= 0 || n > max) throw bad();
  return n;
};

// Rebuild a record from untrusted JSON: known fields only, strict types, bounded sizes. Throws ShareError('malformed').
export function sanitizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  const out = {
    nif: str(raw.nif, 20, { min: 1 }),
    number: str(raw.number, 60, { min: 1 }),
    date: str(raw.date, 10, { re: DMY }),
    generatedAt: str(raw.generatedAt, 40, { re: STAMP }),
    hash: str(raw.hash, 64, { re: HEX64 }).toUpperCase(),
    prevHash: raw.prevHash === '' ? '' : str(raw.prevHash, 64, { re: HEX64 }).toUpperCase(),
    issuerName: str(raw.issuerName, 120),
    prev: null,
  };
  if (raw.prev !== null && raw.prev !== undefined) {
    out.prev = { nif: str(raw.prev.nif, 20), number: str(raw.prev.number, 60), date: str(raw.prev.date, 10, { re: DMY }), hash: str(raw.prev.hash, 64, { re: HEX64 }).toUpperCase() };
  }
  if (raw.kind === 'anulacion') return { ...out, kind: 'anulacion', reason: str(raw.reason ?? '', 200) };
  if (raw.kind !== undefined) throw bad();
  const lines = Array.isArray(raw.lines) ? raw.lines : null;
  const breakdown = Array.isArray(raw.breakdown) ? raw.breakdown : null;
  if (!lines || !lines.length || lines.length > 20 || !breakdown || breakdown.length > RATES.length) throw bad();
  const rec = {
    ...out,
    type: str(raw.type, 4, { min: 1, re: /^[A-Z0-9]+$/ }),
    taxTotal: str(raw.taxTotal, 16, { re: MONEY }),
    total: str(raw.total, 16, { re: MONEY }),
    recipient: { name: str(raw.recipient?.name ?? '', 120), nif: str(raw.recipient?.nif ?? '', 20) },
    description: str(raw.description ?? '', 250),
    lines: lines.map((l) => {
      if (!RATES.includes(l?.vat)) throw bad();
      return { description: str(l.description, 200), qty: amount(l.qty, 10000), price: amount(l.price, 100000), vat: l.vat };
    }),
    breakdown: breakdown.map((b) => {
      if (!RATES.includes(b?.rate)) throw bad();
      return { rate: b.rate, base: str(b.base, 16, { re: MONEY }), tax: str(b.tax, 16, { re: MONEY }) };
    }),
  };
  if (raw.rectifies !== undefined) {
    const t = raw.rectifies;
    if (!t || typeof t !== 'object' || rec.type !== 'R1') throw bad();
    rec.rectifies = { nif: str(t.nif, 20, { min: 1 }), number: str(t.number, 60, { min: 1 }), date: str(t.date, 10, { re: DMY }) };
    rec.tipoRectificativa = str(raw.tipoRectificativa ?? 'S', 1, { re: /^[SI]$/ });
    rec.rectified = { base: str(raw.rectified?.base, 16, { re: MONEY }), tax: str(raw.rectified?.tax, 16, { re: MONEY }) };
    rec.reason = str(raw.reason ?? '', 200);
  }
  if (raw.dueDate !== undefined) rec.dueDate = str(raw.dueDate, 10, { re: ISO_DAY });
  const payer = safeUrl(raw.payerUrl);
  if (payer && payer.length <= 400) rec.payerUrl = payer;
  return rec;
}

const toB64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Inflate with a hard ceiling, so a tiny link can never expand into something huge.
async function inflate(bytes, max) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new ShareError('too-large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// The value that goes after "#r=". Compressed when the browser can and it helps, plain JSON otherwise.
export async function encodeRecord(record, { compress = true } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(shareable(record)));
  if (bytes.length > MAX_JSON) throw new ShareError('too-large');
  let tag = 'j';
  let body = bytes;
  if (compress && typeof CompressionStream === 'function') {
    try {
      const z = await deflate(bytes);
      if (z.length < bytes.length) { tag = 'z'; body = z; }
    } catch { /* plain JSON is the fallback */ }
  }
  const value = `${tag}.${toB64Url(body)}`;
  if (value.length > MAX_FRAGMENT) throw new ShareError('too-large');
  return value;
}

export async function decodeRecord(value) {
  const v = String(value ?? '');
  if (!v) throw new ShareError('empty');
  if (v.length > MAX_FRAGMENT) throw new ShareError('too-large');
  const m = v.match(/^([zj])\.([A-Za-z0-9_-]+)$/);
  if (!m) throw bad();
  let bytes;
  try { bytes = fromB64Url(m[2]); } catch { throw bad(); }
  if (m[1] === 'z') {
    if (typeof DecompressionStream !== 'function') throw new ShareError('unsupported');
    try { bytes = await inflate(bytes, MAX_JSON); } catch (e) { throw e instanceof ShareError ? e : bad(); }
  } else if (bytes.length > MAX_JSON) {
    throw new ShareError('too-large');
  }
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw bad(); }
  return sanitizeRecord(raw);
}

export const shareUrl = async (record, origin) => `${origin}/verify.html#r=${await encodeRecord(record)}`;
// "#r=..." (location.hash) to the value after r=, or ''.
export const fragmentValue = (hash) => new URLSearchParams(String(hash || '').replace(/^#/, '')).get('r') || '';

// Recompute everything that can be recomputed. ok:false means the record is not what the issuer's chain hashed.
// The hash covers issuer NIF, number, date, type, VAT total, total, the previous hash and the timestamp (AEAT
// specification); on top of that the totals must follow from the lines and the previous-record link must agree.
export async function verifyRecord(rec) {
  if ((await sha256Hex(hashInput(rec))) !== rec.hash.toUpperCase()) return { ok: false, reason: 'the content does not match its hash' };
  if (rec.prev ? rec.prev.hash.toUpperCase() !== rec.prevHash.toUpperCase() : rec.prevHash !== '') return { ok: false, reason: 'the link to the previous record does not match' };
  if (!isAnulacion(rec)) {
    const t = totals(rec.lines);
    if (t.total !== rec.total || t.taxTotal !== rec.taxTotal || JSON.stringify(t.breakdown) !== JSON.stringify(rec.breakdown)) return { ok: false, reason: 'the amounts do not match the invoice lines' };
  }
  return { ok: true, hash: rec.hash.toUpperCase() };
}
