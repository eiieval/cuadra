// VeriFactu record engine (RD 1007/2023, Orden HAC/1177/2024): SHA-256 hash chaining,
// AEAT verification QR URL and RegistroAlta XML. Isomorphic: Node 20+ and modern browsers.
// Demo and test-environment use only: this is not a certified invoicing system.

export const QR_BASE = {
  test: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
  prod: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
};
const NS = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';

export const money = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
export const dmy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}-${m}-${y}`; };
const pad = (n) => String(n).padStart(2, '0');

export function isoWithOffset(date = new Date()) {
  const off = -date.getTimezoneOffset();
  const a = Math.abs(off);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Exact field order and format of the AEAT hash specification for RegistroAlta.
export function altaHashInput(r) {
  return [
    ['IDEmisorFactura', r.nif], ['NumSerieFactura', r.number], ['FechaExpedicionFactura', r.date],
    ['TipoFactura', r.type], ['CuotaTotal', r.taxTotal], ['ImporteTotal', r.total],
    ['Huella', r.prevHash || ''], ['FechaHoraHusoGenRegistro', r.generatedAt],
  ].map(([k, v]) => `${k}=${String(v ?? '').trim()}`).join('&');
}

export function totals(lines) {
  const groups = new Map();
  for (const l of lines) {
    const g = groups.get(Number(l.vat)) || { rate: Number(l.vat), base: 0 };
    g.base += Number(l.qty) * Number(l.price);
    groups.set(Number(l.vat), g);
  }
  const breakdown = [...groups.values()].map((g) => ({ rate: g.rate, base: money(g.base), tax: money((g.base * g.rate) / 100) }));
  const taxTotal = money(breakdown.reduce((s, b) => s + Number(b.tax), 0));
  const total = money(breakdown.reduce((s, b) => s + Number(b.base) + Number(b.tax), 0));
  return { breakdown, taxTotal, total };
}

export function qrUrl(r, env = 'test') {
  const u = new URL(QR_BASE[env]);
  u.searchParams.set('nif', r.nif);
  u.searchParams.set('numserie', r.number);
  u.searchParams.set('fecha', r.date);
  u.searchParams.set('importe', r.total);
  return u.toString();
}

export async function buildAlta({ issuer, invoice, prev = null, generatedAt = isoWithOffset() }) {
  const t = totals(invoice.lines);
  const rec = {
    nif: issuer.nif, number: invoice.number, date: dmy(invoice.date), type: invoice.type || 'F1',
    taxTotal: t.taxTotal, total: t.total, prevHash: prev ? prev.hash : '', generatedAt,
  };
  rec.hash = await sha256Hex(altaHashInput(rec));
  return {
    ...rec,
    issuerName: issuer.name,
    recipient: invoice.recipient,
    description: invoice.description || '',
    lines: invoice.lines,
    breakdown: t.breakdown,
    prev: prev ? { nif: prev.nif, number: prev.number, date: prev.date, hash: prev.hash } : null,
    qr: qrUrl(rec),
  };
}

// Tamper evidence: every record must link to the previous hash, rehash to itself and match its lines.
export async function verifyChain(records) {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if ((r.prevHash || '') !== (i ? records[i - 1].hash : '')) return { ok: false, index: i, reason: 'broken link to the previous record' };
    if ((await sha256Hex(altaHashInput(r))) !== r.hash) return { ok: false, index: i, reason: 'record altered after issue' };
    if (Array.isArray(r.lines) && totals(r.lines).total !== r.total) return { ok: false, index: i, reason: 'amounts do not match the invoice lines' };
  }
  return { ok: true, count: records.length };
}

export function validNif(v) {
  const s = String(v || '').toUpperCase().replace(/[\s-]/g, '');
  const L = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (/^\d{8}[A-Z]$/.test(s)) return L[Number(s.slice(0, 8)) % 23] === s[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return L[Number(`${'XYZ'.indexOf(s[0])}${s.slice(1, 8)}`) % 23] === s[8];
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    let sum = 0;
    s.slice(1, 8).split('').map(Number).forEach((n, i) => {
      if (i % 2) sum += n;
      else sum += Math.floor((n * 2) / 10) + ((n * 2) % 10);
    });
    const c = (10 - (sum % 10)) % 10;
    return s[8] === String(c) || s[8] === 'JABCDEFGHI'[c];
  }
  return false;
}

const x = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function altaXml(r) {
  const chain = r.prev
    ? `<sum1:RegistroAnterior><sum1:IDEmisorFactura>${x(r.prev.nif)}</sum1:IDEmisorFactura><sum1:NumSerieFactura>${x(r.prev.number)}</sum1:NumSerieFactura><sum1:FechaExpedicionFactura>${x(r.prev.date)}</sum1:FechaExpedicionFactura><sum1:Huella>${x(r.prev.hash)}</sum1:Huella></sum1:RegistroAnterior>`
    : '<sum1:PrimerRegistro>S</sum1:PrimerRegistro>';
  const detalle = r.breakdown.map((b) => `<sum1:DetalleDesglose><sum1:Impuesto>01</sum1:Impuesto><sum1:ClaveRegimen>01</sum1:ClaveRegimen><sum1:CalificacionOperacion>S1</sum1:CalificacionOperacion><sum1:TipoImpositivo>${money(b.rate)}</sum1:TipoImpositivo><sum1:BaseImponibleOimporteNoSujeto>${b.base}</sum1:BaseImponibleOimporteNoSujeto><sum1:CuotaRepercutida>${b.tax}</sum1:CuotaRepercutida></sum1:DetalleDesglose>`).join('');
  const dest = r.recipient?.nif ? `<sum1:Destinatarios><sum1:IDDestinatario><sum1:NombreRazon>${x(r.recipient.name)}</sum1:NombreRazon><sum1:NIF>${x(r.recipient.nif)}</sum1:NIF></sum1:IDDestinatario></sum1:Destinatarios>` : '';
  return [
    `<sum1:RegistroAlta xmlns:sum1="${NS}">`,
    '  <sum1:IDVersion>1.0</sum1:IDVersion>',
    `  <sum1:IDFactura><sum1:IDEmisorFactura>${x(r.nif)}</sum1:IDEmisorFactura><sum1:NumSerieFactura>${x(r.number)}</sum1:NumSerieFactura><sum1:FechaExpedicionFactura>${x(r.date)}</sum1:FechaExpedicionFactura></sum1:IDFactura>`,
    `  <sum1:NombreRazonEmisor>${x(r.issuerName)}</sum1:NombreRazonEmisor>`,
    `  <sum1:TipoFactura>${x(r.type)}</sum1:TipoFactura>`,
    `  <sum1:DescripcionOperacion>${x(r.description || 'Prestación de servicios')}</sum1:DescripcionOperacion>`,
    dest ? `  ${dest}` : '',
    `  <sum1:Desglose>${detalle}</sum1:Desglose>`,
    `  <sum1:CuotaTotal>${r.taxTotal}</sum1:CuotaTotal>`,
    `  <sum1:ImporteTotal>${r.total}</sum1:ImporteTotal>`,
    `  <sum1:Encadenamiento>${chain}</sum1:Encadenamiento>`,
    '  <sum1:SistemaInformatico><sum1:NombreRazon>Cuadra (demo)</sum1:NombreRazon><sum1:NombreSistemaInformatico>Cuadra</sum1:NombreSistemaInformatico><sum1:IdSistemaInformatico>CU</sum1:IdSistemaInformatico><sum1:Version>0.1</sum1:Version><sum1:NumeroInstalacion>1</sum1:NumeroInstalacion><sum1:TipoUsoPosibleSoloVerifactu>S</sum1:TipoUsoPosibleSoloVerifactu><sum1:TipoUsoPosibleMultiOT>N</sum1:TipoUsoPosibleMultiOT><sum1:IndicadorMultiplesOT>N</sum1:IndicadorMultiplesOT></sum1:SistemaInformatico>',
    `  <sum1:FechaHoraHusoGenRegistro>${x(r.generatedAt)}</sum1:FechaHoraHusoGenRegistro>`,
    '  <sum1:TipoHuella>01</sum1:TipoHuella>',
    `  <sum1:Huella>${x(r.hash)}</sum1:Huella>`,
    '</sum1:RegistroAlta>',
  ].filter(Boolean).join('\n');
}
