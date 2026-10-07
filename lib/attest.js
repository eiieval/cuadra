// Server side of the signed attestation: an Ed25519 key from the environment (ATTEST_PRIVATE_KEY, read here and nowhere
// else, never logged or returned), signing and the public key. With MOCK=1 and no key, a fixed test key pair is derived
// in-process so tests and screenshots work; without either, attestation is simply off.
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto';
import { attestMessage, toB64Url } from '../public/js/attest.js';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex'); // prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows

// PEM (PKCS#8), or base64 / base64url of the 32-byte seed, or of the 48-byte PKCS#8 DER. Null when it is not usable.
export function parsePrivateKey(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  try {
    if (v.includes('BEGIN')) return createPrivateKey(v.split('\\n').join('\n'));
    const raw = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (raw.length === 32) return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, raw]), format: 'der', type: 'pkcs8' });
    if (raw.length === 48) return createPrivateKey({ key: raw, format: 'der', type: 'pkcs8' });
  } catch { /* an unusable key means attestation off, never a crash */ }
  return null;
}

let cache = null;
// { privateKey, publicKey (base64url raw), keyId, mode } or null.
export function attestKey() {
  const env = process.env.ATTEST_PRIVATE_KEY || '';
  const mock = !env && process.env.MOCK === '1';
  const id = mock ? 'mock' : `env:${env.length}:${createHash('sha256').update(env).digest('hex').slice(0, 12)}`;
  if (cache?.id === id) return cache.key;
  let privateKey = null;
  if (mock) privateKey = parsePrivateKey(createHash('sha256').update('cuadra mock attestation key, tests and screenshots only').digest('base64'));
  else if (env) privateKey = parsePrivateKey(env);
  let key = null;
  if (privateKey) {
    const raw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
    key = { privateKey, publicKey: toB64Url(raw), keyId: createHash('sha256').update(raw).digest('hex').slice(0, 16), mode: mock ? 'mock' : 'live' };
  }
  cache = { id, key };
  return key;
}

export function signHash(hash, signedAt = new Date().toISOString()) {
  const key = attestKey();
  if (!key) return null;
  return { signature: toB64Url(edSign(null, Buffer.from(attestMessage(hash, signedAt)), key.privateKey)), keyId: key.keyId, signedAt };
}
