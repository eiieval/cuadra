# AG Charts Community (vendored)

Self-hosted so the page keeps `script-src 'self'`: nothing is loaded from a CDN. The app inserts the script itself, after
the first render, when an Insight needs a chart (`public/js/vendor.js`), and keeps a plain table of the same figures if
it does not load. The app has no runtime dependencies: this file is a vendored asset, not a package.json dependency.

| | |
|---|---|
| Package | `ag-charts-community` |
| Version | 14.2.0 |
| License | MIT (copy of the package's `LICENSE.txt` next to the bundle) |
| File | `ag-charts-community.min.js` = `package/dist/umd/ag-charts-community.min.js` of the npm tarball |
| Size | 1411575 bytes |
| SHA-256 | `156ccaa9b67221a0b1739112ba8120629357cfa51654b36eaa2cedc17dc90d69` |
| LICENSE.txt SHA-256 | `31636f0472dda16bba11a7b78204e1f677b77452092e185a65cddd45b6c9fb29` |
| Tarball integrity (npm registry `dist.integrity`) | `sha512-AQ9u5jJGjCGWY19XMehZFhC5db6e9J5DGCurSGjm1h9MUkfTQfj9KMDHLhTQqdNhVvTXI7J4OB8ZNbWMh3TJug==` |
| Global | `window.agCharts` (UMD) |

It draws on canvas and injects one small `<style>` element for its legend and tooltips (`style-src 'unsafe-inline'` is
already allowed). It loads with zero console errors under the app's CSP.

## Verify it yourself

```
npm pack ag-charts-community@14.2.0
tar -xzf ag-charts-community-14.2.0.tgz package/dist/umd/ag-charts-community.min.js
sha256sum package/dist/umd/ag-charts-community.min.js       # must equal the SHA-256 above
```

`npm test` recomputes the hash of the file in this folder and compares it with the one written here.
