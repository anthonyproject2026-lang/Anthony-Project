# Self-hosted third-party files

These files replace the CDNs the site used before (gstatic.com for Firebase, cdn.tailwindcss.com, cdnjs for Font Awesome and DOMPurify, Google Fonts). Serving them from the site itself lets the Content-Security-Policy allow scripts from `'self'` only, and means a compromised CDN cannot change the registry's code.

They do **not** update themselves. To update, change the pinned version in `dev/package.json`, then:

```bash
cd dev
npm ci
npm audit
npm run build:vendor     # rebuilds and prints SHA-256 hashes for this table
npm test                 # all tests must pass
```

`npm run check:vendor` rebuilds Firebase and Tailwind into a temporary folder and fails if the committed files differ.

DOMPurify was removed: nothing is rendered as HTML any more, so there is nothing to sanitise.

| File | Source | Licence | SHA-256 |
|---|---|---|---|
| `vendor/firebase.bundle.js` | firebase 11.6.1 (npm), bundled with esbuild 0.28.2 | Apache-2.0 (licence comments kept at the end of the file) | `cb23e8d5bd44550a86b3b19225affeb37610a974229906836e8ad280f23875fc` |
| `vendor/fontawesome/LICENSE.txt` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `de784a808496d49f5f80dd9d1d6e9a51cff712cfbc339e7c25155631ae3cdb5d` |
| `vendor/fontawesome/css/all.min.css` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `8d321d88cb97fdedc3189506c25de9292c6e73a60ebaab496243346c6404480e` |
| `vendor/fontawesome/webfonts/fa-brands-400.ttf` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `9e122861bc5f7d6190d580b22acc5b1c3f8cdba9f495593cccd3b47d2cbfa2fd` |
| `vendor/fontawesome/webfonts/fa-brands-400.woff2` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `29bc44694c394921d1f00271128a2e4cd8293516216e24eac07a73fa821fc1f5` |
| `vendor/fontawesome/webfonts/fa-regular-400.ttf` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `709034805d10429d24862ad685d561808328329debdbca4f70487b508320a3ff` |
| `vendor/fontawesome/webfonts/fa-regular-400.woff2` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `fa79fc4f2559112ff3dd27cf5be216d9b5f88066ceef728264f5a3a1a195fc1e` |
| `vendor/fontawesome/webfonts/fa-solid-900.ttf` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `1782156bfa2054db429277b42f143298a1ce03437c05e2779ca7875112b19d3c` |
| `vendor/fontawesome/webfonts/fa-solid-900.woff2` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `1b099f88c06ed0869872561c157f0ec9cbe133a0939d9ece4ee1e1f54bd4683d` |
| `vendor/fontawesome/webfonts/fa-v4compatibility.ttf` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `fde941c0964fab984f6af0697b3fec92e7df384eec9941babfd3e4cbbd6211c2` |
| `vendor/fontawesome/webfonts/fa-v4compatibility.woff2` | @fortawesome/fontawesome-free 6.0.0 (npm), copied unchanged | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT — see fontawesome/LICENSE.txt | `b3abfccce275536beaaeba990e900a0c08ed2fefbabf4a8bcbb2e2ffe3f2431f` |
| `vendor/fonts/OUTFIT-LICENSE.txt` | @fontsource-variable/outfit 5.3.0 (npm), copied unchanged | SIL OFL 1.1 — see fonts/OUTFIT-LICENSE.txt | `0e5fcef5d93bfcae273c11c00f0bb453d3b5491860e1ac8b658767b7577c938f` |
| `vendor/fonts/outfit-latin-ext-wght-normal.woff2` | @fontsource-variable/outfit 5.3.0 (npm), copied unchanged | SIL OFL 1.1 — see fonts/OUTFIT-LICENSE.txt | `0f53d1c03b3918d744a843b5039001ee31695ca1e255e3914188df81beb461e9` |
| `vendor/fonts/outfit-latin-wght-normal.woff2` | @fontsource-variable/outfit 5.3.0 (npm), copied unchanged | SIL OFL 1.1 — see fonts/OUTFIT-LICENSE.txt | `6c18d579fd87c3776be068b762cbc83fde3acb543d49eabd3ade842eb987e887` |
| `vendor/tailwind.css` | tailwindcss 3.4.17 (npm), compiled from index.html + src/*.js | MIT | `9c328c9614da6a1ea241c3baa36a506cc5983abc6f8efaac32fc8276fd7ba44d` |

Font Awesome attribution: Font Awesome Free 6.0.0 by @fontawesome — https://fontawesome.com (licence: https://fontawesome.com/license/free).
Outfit font: Copyright 2021 The Outfit Project Authors, licensed under the SIL Open Font License 1.1.
