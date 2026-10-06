# AG Grid Community (vendored)

Self-hosted so the page keeps `script-src 'self'`: nothing is loaded from a CDN. The app inserts the script itself, after
the first render and only from 768 px up (`public/js/vendor.js`), and keeps the plain HTML table if it does not load.
The app has no runtime dependencies: this file is a vendored asset, not a package.json dependency.

| | |
|---|---|
| Package | `ag-grid-community` |
| Version | 36.2.0 |
| License | MIT (copy of the package's `LICENSE.txt` next to the bundle) |
| File | `ag-grid-community.min.noStyle.js` = `package/dist/ag-grid-community.min.noStyle.js` of the npm tarball |
| Size | 1410238 bytes |
| SHA-256 | `3b05777f78aa10b6d7fd020bc2076936b889e5a0ff9c1a764fdbe6aa19456993` |
| LICENSE.txt SHA-256 | `31636f0472dda16bba11a7b78204e1f677b77452092e185a65cddd45b6c9fb29` |
| Tarball integrity (npm registry `dist.integrity`) | `sha512-tK0Toj7t0fV/OMLPnDc0xlYKAqDbnCT3iJodYSn2TJ541caU8jPdYwWhMdW+AP2+pUNwFiJVgc04eJNfvBPsWw==` |
| Global | `window.agGrid` (UMD) |

## Why the noStyle build

`ag-grid-community.min.js` (2058454 bytes) injects, as soon as it loads, the CSS of every legacy theme (Alpine, Balham,
Material, Quartz), including `@font-face` rules with `data:` fonts. Our CSP only allows fonts from fonts.gstatic.com, so
the browser logs one CSP error per font. The `noStyle` build (the same code without the legacy CSS) injects nothing at
load; the grid then injects the CSS of the Theming API theme we ask for (`themeQuartz` + `colorSchemeDark`, built from
the `:root` tokens), which only needs `style-src 'unsafe-inline'`, already allowed. It is 648 KB smaller and loads with
zero console errors. The full build was measured to behave the same visually.

## Verify it yourself

```
npm pack ag-grid-community@36.2.0
tar -xzf ag-grid-community-36.2.0.tgz package/dist/ag-grid-community.min.noStyle.js
sha256sum package/dist/ag-grid-community.min.noStyle.js     # must equal the SHA-256 above
```

`npm test` recomputes the hash of the file in this folder and compares it with the one written here.
