// Signed attestation of an issued record.
//   GET  /api/attest  -> { enabled, algorithm, publicKey, keyId, mode }   ({ enabled: false } with 200 when this deployment has no key,
//                        so a page load never logs an error in the browser console)
//   POST /api/attest  { nif, number, date, type, taxTotal, total, prevHash, generatedAt, hash } -> { signature, keyId, signedAt }
// The server recomputes the VeriFactu hash from the fields and signs it only if it matches, and only for a record that was
// generated moments ago: a backdated or invented hash is refused. It vouches that this deployment saw that hash at that
// time, not who the issuer is (the AEAT QR is what proves that). No key configured: attestation is off, nothing breaks.
import { attestKey, signHash } from '../lib/attest.js';
import { altaHashInput, sha256Hex } from '../public/js/verifactu.js';
import { guard, json, clean, sameSiteBrowser } from '../lib/guard.js';

const FRESH_MS = 10 * 60 * 1000;
const MONEY = /^\d{1,12}\.\d{2}$/;
const HEX64 = /^[0-9A-Fa-f]{64}$/;
const DMY = /^\d{2}-\d{2}-\d{4}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export default async function handler(req, res) {
  const key = attestKey();
  if (req.method === 'GET') {
    if (!key) return json(res, 200, { enabled: false }, { 'cache-control': 'public, max-age=60' });
    return json(res, 200, { enabled: true, algorithm: 'Ed25519', publicKey: key.publicKey, keyId: key.keyId, mode: key.mode }, { 'cache-control': 'public, max-age=300' });
  }
  if (!key) return json(res, 404, { enabled: false });
  const g = await guard(req, res, { name: 'attest', perIp: 60, windowMs: 60 * 60 * 1000, dailyCap: 3000 });
  if (!g) return;
  if (!sameSiteBrowser(req)) return json(res, 403, { error: 'This action is only available from the Cuadra page' });
  const b = g.body && typeof g.body === 'object' ? g.body : {};
  const rec = {
    nif: clean(b.nif, 20), number: clean(b.number, 60), date: clean(b.date, 10), type: clean(b.type, 4),
    taxTotal: clean(b.taxTotal, 16), total: clean(b.total, 16), prevHash: clean(b.prevHash, 64), generatedAt: clean(b.generatedAt, 40), hash: clean(b.hash, 64),
  };
  const shaped = rec.nif && rec.number && DMY.test(rec.date) && ['F1', 'R1'].includes(rec.type) && MONEY.test(rec.taxTotal) && MONEY.test(rec.total)
    && (rec.prevHash === '' || HEX64.test(rec.prevHash)) && STAMP.test(rec.generatedAt) && HEX64.test(rec.hash);
  if (!shaped) return json(res, 400, { error: 'Invalid record' });
  if ((await sha256Hex(altaHashInput(rec))) !== rec.hash.toUpperCase()) return json(res, 400, { error: 'The hash does not match the record' });
  const age = Math.abs(Date.now() - Date.parse(rec.generatedAt));
  if (!(age <= FRESH_MS)) return json(res, 400, { error: 'Only records issued in the last few minutes can be signed' });
  return json(res, 200, signHash(rec.hash));
}
