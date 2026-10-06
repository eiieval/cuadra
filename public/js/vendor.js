// Vendored libraries, loaded on demand from our own origin. The page inserts the <script> itself, so the CSP keeps
// `script-src 'self'` (no CDN, no new origin). Each entry says where the file is, which global it defines and its
// Subresource Integrity hash: the browser refuses a file that is not byte for byte the one in public/vendor/<lib>/
// (scripts/test.js recomputes these hashes and compares them with VERSION.md).
export const VENDOR = {
  grid: {
    src: '/vendor/ag-grid/ag-grid-community.min.noStyle.js',
    global: 'agGrid',
    integrity: 'sha256-OwV3f3iqELbX/QILwgdpNriJ5aD/nBp2T9vmqhlFaZM=',
  },
  charts: {
    src: '/vendor/ag-charts/ag-charts-community.min.js',
    global: 'agCharts',
    integrity: 'sha256-FWzKqbZyIaCxc5ESuoEgYpNXz6UWVLNuqiztwX3JDWk=',
  },
};

const jobs = new Map();

// Resolves to the library's global object, or to null if the file does not arrive within `timeout` ms, fails to load
// or is rejected by the integrity check. It never throws: callers keep their plain fallback and show no error.
// A file that arrives after the timeout is not lost: the next call finds the global already there.
export function loadVendor(lib, { timeout = 3000 } = {}) {
  const spec = VENDOR[lib];
  if (!spec) return Promise.resolve(null);
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window[spec.global]) return Promise.resolve(window[spec.global]);
  if (jobs.has(lib)) return jobs.get(lib);
  const job = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeout);
    const script = document.createElement('script');
    script.async = true;
    script.integrity = spec.integrity;
    script.onload = () => finish(window[spec.global] || null);
    script.onerror = () => {
      script.remove();
      jobs.delete(lib); // a later call may try again (the network may be back)
      finish(null);
    };
    script.src = spec.src;
    document.head.append(script);
  });
  jobs.set(lib, job);
  return job;
}
