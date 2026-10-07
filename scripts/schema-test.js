// Validates the ledger records against docs/schema/record.schema.json with a small built-in validator (no dependency).
// The validator covers the keywords the schema uses: $ref, oneOf, type, enum, const, pattern, required, properties,
// additionalProperties (false), items, min/max length, min/max items and minimum/maximum. Not a general JSON Schema engine.
import { readFileSync } from 'node:fs';
import { buildAlta, buildAnulacion, buildRectificativa } from '../public/js/verifactu.js';
import { buildSample } from '../public/js/ledger.js';

let failed = 0;
const expect = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };

const schema = JSON.parse(readFileSync(new URL('../docs/schema/record.schema.json', import.meta.url), 'utf8'));

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

// Returns the list of problems ("path: what is wrong"); an empty list means valid.
export function validate(value, node, root = schema, path = '$') {
  if (node.$ref) {
    const target = node.$ref.replace(/^#\//, '').split('/').reduce((n, k) => n?.[k], root);
    if (!target) return [`${path}: unresolved ${node.$ref}`];
    return validate(value, target, root, path);
  }
  const errors = [];
  if (node.oneOf) {
    const hits = node.oneOf.filter((n) => !validate(value, n, root, path).length).length;
    if (hits !== 1) errors.push(`${path}: matches ${hits} of ${node.oneOf.length} alternatives, expected exactly one`);
  }
  if (node.type && !(Array.isArray(node.type) ? node.type : [node.type]).some((t) => isType(value, t))) return [`${path}: expected ${node.type}, got ${typeOf(value)}`];
  if (node.enum && !node.enum.some((e) => e === value)) errors.push(`${path}: not one of ${JSON.stringify(node.enum)}`);
  if ('const' in node && node.const !== value) errors.push(`${path}: must be ${JSON.stringify(node.const)}`);
  if (typeof value === 'string') {
    if (node.pattern && !new RegExp(node.pattern).test(value)) errors.push(`${path}: does not match ${node.pattern}`);
    if (node.minLength != null && value.length < node.minLength) errors.push(`${path}: shorter than ${node.minLength}`);
    if (node.maxLength != null && value.length > node.maxLength) errors.push(`${path}: longer than ${node.maxLength}`);
  }
  if (typeof value === 'number') {
    if (node.minimum != null && value < node.minimum) errors.push(`${path}: below ${node.minimum}`);
    if (node.maximum != null && value > node.maximum) errors.push(`${path}: above ${node.maximum}`);
  }
  if (Array.isArray(value)) {
    if (node.minItems != null && value.length < node.minItems) errors.push(`${path}: fewer than ${node.minItems} items`);
    if (node.maxItems != null && value.length > node.maxItems) errors.push(`${path}: more than ${node.maxItems} items`);
    if (node.items) value.forEach((v, i) => errors.push(...validate(v, node.items, root, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    for (const k of node.required || []) if (!keys.includes(k)) errors.push(`${path}: missing ${k}`);
    if (node.additionalProperties === false) for (const k of keys) if (!node.properties?.[k]) errors.push(`${path}: unexpected property ${k}`);
    for (const [k, sub] of Object.entries(node.properties || {})) if (keys.includes(k)) errors.push(...validate(value[k], sub, root, `${path}.${k}`));
  }
  return errors;
}

// A record as it is stored: JSON, so undefined fields are gone.
const stored = (r) => JSON.parse(JSON.stringify(r));
const problems = (r) => validate(stored(r), schema);

const issuer = { name: 'Estudio Norte SL', nif: 'B76543214', series: 'SCH' };
const sample = await buildSample({ issuer, today: '2026-10-06' });
expect('the schema is draft 2020-12 and offers the three record kinds', schema.$schema.includes('2020-12') && schema.oneOf.length === 3);
expect(`the ${sample.length} records of the sample quarter (invoices and the cancellation) validate`, sample.every((r) => !problems(r).length));

const target = sample.find((r) => r.paidAt);
const withPaypal = { ...sample[3], paypal: { id: 'INV2-MOCK-0001', token: 'abc.def', status: 'SENT', payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#MOCK' }, email: 'a@b.example', paidMethod: 'BANK_TRANSFER' };
expect('an invoice with its PayPal data, e-mail and payment method validates', !problems(withPaypal).length);
const r1 = await buildRectificativa({ issuer, target, number: 'SCH-0009', date: '2026-10-06', lines: [{ description: 'Corrected', qty: 1, price: 1000, vat: 21 }], reason: 'Wrong price', prev: sample.at(-1), generatedAt: '2026-10-06T10:00:00+02:00' });
expect('a corrective invoice (R1) validates, with rectifies, tipoRectificativa and rectified', !problems({ ...r1, paidAt: '2026-10-06' }).length);
const anul = await buildAnulacion({ issuer, target: sample[4], prev: sample.at(-1), reason: 'Duplicate', generatedAt: '2026-10-06T11:00:00+02:00' });
expect('a cancellation record validates', !problems(anul).length);
const first = await buildAlta({ issuer, invoice: { number: 'SCH-0100', date: '2026-10-06', recipient: { name: 'School' }, lines: [{ description: 'Course', qty: 1, price: 100, vat: 0 }] }, generatedAt: '2026-10-06T12:00:00+02:00' });
expect('the first record of a chain (empty prevHash, null link) validates, with a recipient without NIF', !problems(first).length && first.prevHash === '' && first.prev === null);

const bad = (mutate) => { const c = stored(sample[0]); mutate(c); return problems(c); };
expect('required: an invoice without its hash is rejected', bad((c) => { delete c.hash; }).length > 0);
expect('additionalProperties: an unknown field is rejected', bad((c) => { c.status = 'PAID'; }).length > 0);
expect('pattern: a hash that is not 64 upper-case hex is rejected', bad((c) => { c.hash = 'abc'; }).length > 0);
expect('pattern: a date that is not dd-mm-yyyy is rejected', bad((c) => { c.date = '2026-10-06'; }).length > 0);
expect('pattern: an amount without two decimals is rejected', bad((c) => { c.total = '12'; }).length > 0);
expect('enum: a VAT rate outside 0, 4, 10, 21 is rejected', bad((c) => { c.lines[0].vat = 7; }).length > 0);
expect('enum: an unknown TipoFactura is rejected', bad((c) => { c.type = 'Z9'; }).length > 0);
expect('type: a numeric total is rejected (amounts are strings computed by the engine)', bad((c) => { c.total = 217.8; }).length > 0);
expect('minimum: a line with quantity zero is rejected', bad((c) => { c.lines[0].qty = 0; }).length > 0);
expect('minItems: an invoice without lines is rejected', bad((c) => { c.lines = []; }).length > 0);
const ghost = stored(r1);
delete ghost.rectifies;
expect('an R1 without the reference to the rectified invoice is rejected', validate(ghost, schema).length > 0);
const wrongKind = stored(anul);
wrongKind.kind = 'baja';
expect('const: a cancellation with another kind is rejected', validate(wrongKind, schema).length > 0);
expect('a cancellation cannot carry invoice lines', validate({ ...stored(anul), lines: [] }, schema).length > 0);

// The docs the README links to exist and keep their honest statements.
const doc = (f) => readFileSync(new URL(`../docs/${f}`, import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
expect('docs: ARCHITECTURE, COMPLIANCE and MONETIZATION exist and the README links to them and to the schema', ['ARCHITECTURE.md', 'COMPLIANCE.md', 'MONETIZATION.md', 'schema/record.schema.json'].every((f) => doc(f).length > 500 && readme.includes(`docs/${f}`)));
expect('docs: COMPLIANCE says it is not certified, has no electronic signature and does not validate the XSD; MONETIZATION labels its numbers as estimates', /not a certified/i.test(doc('COMPLIANCE.md')) && /No electronic signature/.test(doc('COMPLIANCE.md')) && /not validated against the XSD|XML is not validated/i.test(doc('COMPLIANCE.md')) && /estimate/i.test(doc('MONETIZATION.md').slice(0, 300)));

console.log(failed ? `${failed} schema check(s) failed` : 'all schema checks passed');
process.exit(failed ? 1 : 0);
