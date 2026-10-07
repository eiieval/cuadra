// Signed attestation: the Cuadra deployment signs the hash of a record when it is issued (api/attest.js, Ed25519), and
// anyone can check that signature in the browser with the public key from GET /api/attest. What it proves: this
// deployment saw exactly this hash at that time. What it does not prove: who the issuer is (scan the AEAT QR for that).
// Isomorphic (browser and Node 20+, WebCrypto), no dependencies; every function here is pure apart from fetchAttestKey.

// The hashed fields of a record: the server recomputes the hash from these and refuses a signature if it does not match.
export const ATTEST_FIELDS = ['nif', 'number', 'date', 'type', 'taxTotal', 'total', 'prevHash', 'generatedAt', 'hash'];
export const attestPayload = (r) => Object.fromEntries(ATTEST_FIELDS.map((k) => [k, String(r?.[k] ?? '')]));

// What is signed: the hash and the moment of signing, so the date shown next to "Signed" is part of the signature.
export const attestMessage = (hash, signedAt) => `${String(hash).toUpperCase()}|${signedAt}`;

export const toB64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const fromB64Url = (s) => {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

// info: { publicKey: base64url of the 32 raw bytes, keyId }. Resolves to a CryptoKey, or null when this browser cannot do Ed25519.
export async function importAttestKey(info) {
  try {
    return await globalThis.crypto.subtle.importKey('raw', fromB64Url(info.publicKey), { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return null;
  }
}

// rec: a record (with rec.attestation when the deployment signed it). key: the info from GET /api/attest, or null when it
// could not be fetched. Resolves to { state, keyId?, signedAt? } with state:
//   signed    the signature is valid for this record's hash, by the key this deployment publishes
//   unsigned  the record carries no attestation
//   invalid   it carries one that does not verify (forged, or for another record)
//   unchecked we could not check (no key, no Ed25519 in this browser, another deployment's key)
export async function checkAttestation(rec, key) {
  const a = rec?.attestation;
  if (!a) return { state: 'unsigned' };
  if (!key) return { state: 'unchecked', reason: 'key' };
  if (a.keyId !== key.keyId) return { state: 'unchecked', reason: 'other-key', keyId: a.keyId };
  const pub = await importAttestKey(key);
  if (!pub) return { state: 'unchecked', reason: 'crypto' };
  try {
    const ok = await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, pub, fromB64Url(a.signature), new TextEncoder().encode(attestMessage(rec.hash, a.signedAt)));
    return ok ? { state: 'signed', keyId: a.keyId, signedAt: a.signedAt } : { state: 'invalid' };
  } catch {
    return { state: 'invalid' };
  }
}

let keyPromise = null;
// GET /api/attest once per page. null when the deployment has no key (404), is unreachable, or answers nonsense.
export function fetchAttestKey(fetchFn = globalThis.fetch?.bind(globalThis)) {
  keyPromise ||= (async () => {
    try {
      const r = await fetchFn('/api/attest', { headers: { accept: 'application/json' } });
      if (!r.ok) return null;
      const j = await r.json();
      return j && /^[A-Za-z0-9_-]{43}$/.test(j.publicKey) && /^[0-9a-f]{16}$/.test(j.keyId) ? { publicKey: j.publicKey, keyId: j.keyId, mode: j.mode === 'mock' ? 'mock' : 'live' } : null;
    } catch {
      return null;
    }
  })();
  return keyPromise;
}
export const forgetAttestKey = () => { keyPromise = null; }; // tests

// The words for a result: { tone: 'ok'|'info'|'bad', text }. Plain text, the caller escapes it.
export function attestWords(result) {
  const when = result.signedAt ? ` · ${result.signedAt.slice(0, 16).replace('T', ' ')} UTC` : '';
  switch (result.state) {
    case 'signed': return { tone: 'ok', text: `Signed by this Cuadra deployment · key ${result.keyId}${when}` };
    case 'invalid': return { tone: 'bad', text: 'The signature on this copy does not verify' };
    case 'unchecked': return { tone: 'info', text: result.reason === 'other-key' ? 'Signed with another key: signature not checked' : 'Signature not checked' };
    default: return { tone: 'info', text: 'Unsigned copy' };
  }
}
