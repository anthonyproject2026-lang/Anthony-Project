// Tailwind 3.4.17 — the same version the Play CDN (cdn.tailwindcss.com) served
// when this file was written. Paths are relative to dev/.
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
module.exports = {
    content: [path.join(root, 'index.html'), path.join(root, 'src', '**', '*.js')],
    theme: { extend: {} },
    plugins: []
};
