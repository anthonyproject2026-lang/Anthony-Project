// Builds the self-hosted third-party files in ../vendor.
//   node build/build-vendor.mjs          -> (re)build and write vendor/
//   node build/build-vendor.mjs --check  -> rebuild into a temp folder and fail if different
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(dev, '..');
const check = process.argv.includes('--check');
const out = check ? mkdtempSync(join(tmpdir(), 'shema-vendor-')) : join(repo, 'vendor');
const nm = join(dev, 'node_modules');
// Run tools through node directly (no shell), so paths with spaces are safe.
const runNode = (script, args) => execFileSync(process.execPath, [script, ...args], { cwd: dev, stdio: 'inherit' });
const esbuild = await import('esbuild');

mkdirSync(out, { recursive: true });

// 1. Firebase SDK (only the functions app.js imports), ES module.
await esbuild.build({
    entryPoints: [join(dev, 'build', 'firebase-entry.js')], bundle: true, format: 'esm', minify: true,
    legalComments: 'eof', target: 'es2020', outfile: join(out, 'firebase.bundle.js'), logLevel: 'warning'
});

// 2. Tailwind CSS, compiled from the classes used in index.html and src/*.js.
runNode(join(nm, 'tailwindcss', 'lib', 'cli.js'), ['-c', 'build/tailwind.config.cjs', '-i', 'build/tailwind.input.css',
    '-o', join(out, 'tailwind.css'), '--minify']);

if (!check) {
    // 3. Font Awesome Free 6.0.0 (same version the site used from cdnjs).
    const fa = join(nm, '@fortawesome', 'fontawesome-free');
    mkdirSync(join(out, 'fontawesome', 'css'), { recursive: true });
    mkdirSync(join(out, 'fontawesome', 'webfonts'), { recursive: true });
    cpSync(join(fa, 'css', 'all.min.css'), join(out, 'fontawesome', 'css', 'all.min.css'));
    cpSync(join(fa, 'LICENSE.txt'), join(out, 'fontawesome', 'LICENSE.txt'));
    for (const f of readdirSync(join(fa, 'webfonts'))) {
        cpSync(join(fa, 'webfonts', f), join(out, 'fontawesome', 'webfonts', f));
    }
    // 4. Outfit variable font (SIL OFL 1.1).
    const outfit = join(nm, '@fontsource-variable', 'outfit');
    mkdirSync(join(out, 'fonts'), { recursive: true });
    for (const f of readdirSync(join(outfit, 'files'))) cpSync(join(outfit, 'files', f), join(out, 'fonts', f));
    cpSync(join(outfit, 'LICENSE'), join(out, 'fonts', 'OUTFIT-LICENSE.txt'));
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
function walk(d) {
    return readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
}

if (check) {
    let bad = 0;
    for (const f of ['firebase.bundle.js', 'tailwind.css']) {
        const a = sha(join(out, f)), b = sha(join(repo, 'vendor', f));
        console.log(`${a === b ? 'OK  ' : 'DIFF'} vendor/${f}`);
        if (a !== b) bad++;
    }
    rmSync(out, { recursive: true, force: true });
    if (bad) { console.error('Committed vendor files are out of date. Run npm run build:vendor.'); process.exit(1); }
} else {
    for (const f of walk(out).sort()) {
        if (f.endsWith('VENDOR.md')) continue;
        console.log(`${sha(f)}  ${relative(repo, f).split(sep).join('/')}`);
    }
}
