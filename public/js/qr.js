// QR codes as inline SVG, drawn by the vendored library (public/vendor/qrcode/qrcode.js, window.qrcode).
export function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
