// Local static server for tests. Serves the repo root on 127.0.0.1 and applies the
// "headers" from ../vercel.json, so the page is tested with the real CSP.
//   node serve.mjs [port] [--no-csp] [--root <dir>]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

export function loadHeaderRules(vercelJsonPath) {
    const cfg = JSON.parse(readFileSync(vercelJsonPath, 'utf8'));
    return (cfg.headers || []).map(h => ({ re: new RegExp('^' + h.source + '$'), headers: h.headers }));
}

export function startServer({ root = resolve(here, '..'), port = 0, csp = true, vercelJson } = {}) {
    const rules = loadHeaderRules(vercelJson || join(root, 'vercel.json'));
    const rootAbs = resolve(root);
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            let rel = decodeURIComponent(url.pathname);
            let file = normalize(join(rootAbs, rel));
            if (file !== rootAbs && !file.startsWith(rootAbs + sep)) { res.writeHead(403); res.end(); return; }
            let st = await stat(file).catch(() => null);
            if (st && st.isDirectory()) { file = join(file, 'index.html'); st = await stat(file).catch(() => null); }
            if (!st) { file = join(rootAbs, 'index.html'); } // mirrors the vercel.json rewrite
            const body = await readFile(file);
            const headers = { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
            for (const r of rules) {
                if (!r.re.test(url.pathname)) continue;
                for (const { key, value } of r.headers) {
                    if (!csp && key.toLowerCase() === 'content-security-policy') continue;
                    if (key.toLowerCase() === 'strict-transport-security') continue; // meaningless on http://127.0.0.1
                    headers[key] = value;
                }
            }
            res.writeHead(200, headers);
            res.end(body);
        } catch (e) {
            res.writeHead(500); res.end();
        }
    });
    return new Promise(ok => server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const port = Number(args.find(a => /^\d+$/.test(a)) || 0);
    const rootIdx = args.indexOf('--root');
    const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : resolve(here, '..');
    const { url } = await startServer({ root, port, csp: !args.includes('--no-csp'), vercelJson: join(resolve(here, '..'), 'vercel.json') });
    console.log(`Serving ${root} at ${url}${args.includes('--no-csp') ? ' (CSP off)' : ''}`);
}
