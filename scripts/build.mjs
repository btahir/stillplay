/**
 * Build dist/: compile the C cores, copy the static site, then write everything that is
 * driven by the game registry: one HTML file per route with its own metadata and JSON-LD,
 * Open Graph PNGs, sitemap.xml, robots.txt, the web manifest and the offline service worker.
 *
 *   scripts/heavy.sh node scripts/build.mjs             full build
 *   scripts/heavy.sh node scripts/build.mjs --no-cores  reuse the committed cores/*.wasm
 *
 * SITE_URL sets the absolute origin used in canonical links, Open Graph tags and the sitemap.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { allPaths, jsonLd, pageMeta } from '../src/site/meta.js';
import { siteGames } from '../src/site/registry.js';
import { match } from '../src/site/router.js';
import { drawMini } from '../src/site/minis.js';
import { secrets } from '../src/secrets.js';
import { ogHtml } from './lib/og.mjs';
import { renderPngs } from './lib/render-png.mjs';
import { prerender } from './lib/prerender.mjs';
import { createStaticServer } from './dev.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const origin = (process.env.SITE_URL || 'https://stillplay.vercel.app').replace(/\/+$/, '');

// ---- 1. cores ------------------------------------------------------------------
const cores = (await readdir(join(root, 'cores'))).filter((name) => name.endsWith('.c')).map((name) => name.slice(0, -2));
let compiler = 'committed wasm (--no-cores)';
if (!args.includes('--no-cores')) {
  const candidates = [process.env.CLANG, join(homedir(), '.cache/toolchains/wasi-sdk-34.0-arm64-macos/bin/clang'), 'clang', 'clang-19', '/tmp/stillplay-toolchain/bin/clang'].filter(Boolean);
  compiler = candidates.find((command) => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0);
  if (!compiler) throw new Error('A WebAssembly-capable clang and wasm-ld are required. Set CLANG=/path/to/clang. See README.md.');
  for (const game of cores) {
    const result = spawnSync(compiler, [
      '--target=wasm32', '-O2', '-nostdlib', '-fno-builtin', '-Wl,--no-entry', '-Wl,--export-all',
      '-Wl,--strip-all', join(root, 'cores', `${game}.c`), '-o', join(root, 'cores', `${game}.wasm`),
    ], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${game} compilation failed.`);
  }
}
const verify = spawnSync(process.execPath, [join(root, 'scripts/verify-scoreboard.mjs')], { stdio: 'inherit' });
if (verify.status !== 0) throw new Error('Scoreboard evidence checks failed.');

// ---- 2. copy -------------------------------------------------------------------
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html', 'src', 'cores', 'scoreboard']) await cp(join(root, name), join(dist, name), { recursive: true });
if (existsSync(join(root, 'public'))) await cp(join(root, 'public'), dist, { recursive: true });
await rm(join(dist, 'src/site/service-worker.js'), { force: true });

const commitResult = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' });
const buildCommit = commitResult.status === 0 && /^[a-f0-9]{40}$/.test(commitResult.stdout.trim()) ? commitResult.stdout.trim() : null;
for (const game of (await readdir(join(dist, 'scoreboard'))).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))) {
  const path = join(dist, 'scoreboard', `${game}.json`);
  const data = JSON.parse(await readFile(path, 'utf8'));
  data.buildCommit = buildCommit;
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

// ---- 3. offline: precache list and build hash ------------------------------------
const offline = (await walk(dist)).map((path) => `/${relative(dist, path).split('\\').join('/')}`).filter((path) => (
  (path.startsWith('/src/') && /\.(js|css)$/.test(path))
  || /^\/cores\/[\w-]+\.wasm$/.test(path)
  || /^\/fonts\/space-grotesk-latin-[45]00-normal\.woff2$/.test(path)
  || path.startsWith('/icons/')
  || path.startsWith('/scoreboard/')
  || ['/favicon.svg', '/manifest.webmanifest'].includes(path)
)).sort();
const hash = createHash('sha256');
for (const path of [...offline, '/index.html']) hash.update(path).update(await readFile(join(dist, path)));
const build = hash.digest('hex').slice(0, 12);
const worker = (await readFile(join(root, 'src/site/service-worker.js'), 'utf8'))
  .replace('__STILLPLAY_BUILD__', build)
  .replace("['__STILLPLAY_PRECACHE__']", JSON.stringify(offline));
await writeFile(join(dist, 'sw.js'), worker);

// ---- 4. manifest shortcuts from the registry ---------------------------------------
const manifest = JSON.parse(await readFile(join(root, 'public/manifest.webmanifest'), 'utf8'));
manifest.shortcuts = [
  manifest.shortcuts.find((shortcut) => shortcut.url === '/daily'),
  ...siteGames().filter((game) => game.playable).map((game) => ({ name: `Play ${game.title}`, short_name: game.title, url: game.path, icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] })),
].filter(Boolean).slice(0, 4);
await writeFile(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

// ---- 5. Open Graph images ----------------------------------------------------------
const paths = allPaths({ secrets });
const ogName = (path) => (path === '/' ? 'home' : path.slice(1).replaceAll('/', '-'));
const firstPlayable = siteGames().find((game) => game.playable);
function artFor(meta) {
  const key = meta.og?.art;
  if (key === 'scoreboard') return { svg: 'scoreboard' };
  if (key === 'secrets') return { svg: secrets[0].art, secret: true };
  if (key === 'home' || key === 'daily') return { svg: drawMini(key === 'daily' ? 'minesweeper' : firstPlayable?.id || 'minesweeper') };
  return { svg: drawMini(key) };
}
const css = await readFile(join(root, 'src/site/site.css'), 'utf8');
const ogCache = join(root, '.cache/og');
await mkdir(ogCache, { recursive: true });
await mkdir(join(dist, 'og'), { recursive: true });
const ogJobs = [];
const ogFiles = new Map();
for (const path of paths) {
  const meta = pageMeta(path, { secrets });
  const html = ogHtml(meta, { css, root, art: artFor(meta) });
  const key = createHash('sha256').update(html).digest('hex').slice(0, 16);
  const cached = join(ogCache, `${key}.png`);
  ogFiles.set(path, { cached, name: ogName(path) });
  if (!existsSync(cached)) ogJobs.push({ out: cached, width: 1200, height: 630, html });
}
let ogFormat = 'png';
if (ogJobs.length && !(await renderPngs(ogJobs, { baseDir: join(root, '.cache') }))) {
  ogFormat = 'svg';
  console.warn('Playwright is unavailable: Open Graph images fall back to the static SVG card.');
}
for (const { cached, name } of ogFiles.values()) {
  if (ogFormat === 'png') await cp(cached, join(dist, 'og', `${name}.png`));
}

// ---- 6. one HTML file per route ------------------------------------------------------
const template = await readFile(join(dist, 'index.html'), 'utf8');
const attribute = (text) => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const xml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A module's own static imports (one level), as project-relative paths. */
async function directImports(file) {
  const source = await readFile(join(root, file), 'utf8');
  return [...source.matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)].map((found) => join(dirname(file), found[1]));
}

const PAGE_MODULES = { home: 'pages/home.js', game: 'pages/game.js', daily: 'pages/daily.js', scoreboard: 'pages/scoreboard.js', about: 'pages/about.js', secrets: 'pages/secrets.js', secret: 'pages/secrets.js', soon: 'pages/coming-soon.js', 'not-found': 'pages/not-found.js' };

/**
 * The modules a route needs first, so the browser fetches them in parallel instead of
 * discovering them one import at a time. Game routes add the game's own module, read from
 * the registry's mount import.
 */
async function preloadsFor(path) {
  const route = match(path);
  const entries = ['src/site/router.js', `src/site/${PAGE_MODULES[route.name]}`];
  const game = path === '/' ? firstPlayable : route.name === 'game' ? route.params.game : null;
  if (game) {
    entries.push('src/site/play/stage.js');
    const module = game.mount.toString().match(/import\(['"]\.\/([\w./-]+)['"]\)/)?.[1];
    // The game module and its core, so the board is ready as soon as possible.
    if (module) entries.push(`src/${module}`, ...(await directImports(`src/${module}`)).filter((file) => file.endsWith('-core.js')));
  }
  // The route's direct chain only. Preloading the whole module graph made the first paint
  // compete with a dozen small modules (measured with Lighthouse, 2026-10-18).
  return entries.map((file) => `/${file}`);
}

/** Safe CSS minification: drop comments and collapse whitespace. */
const minifyCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}').trim();
// Inline the render-blocking stylesheets: the first paint then needs only the HTML.
const inlined = [];
for (const href of [...template.matchAll(/<link rel="stylesheet" href="(\/src\/[^"]+\.css)">/g)].map((found) => found[1])) {
  inlined.push([href, minifyCss(await readFile(join(dist, href), 'utf8'))]);
}

for (const path of paths) {
  const meta = pageMeta(path, { secrets });
  if (!meta) throw new Error(`No metadata for ${path}`);
  const url = `${origin}${path === '/' ? '/' : path}`;
  const image = ogFormat === 'png' ? `${origin}/og/${ogFiles.get(path).name}.png` : `${origin}/og.svg`;
  const structured = jsonLd(path, origin, meta);
  const preloads = await preloadsFor(path);
  const head = [
    `<link rel="canonical" href="${attribute(url)}">`,
    `<meta property="og:url" content="${attribute(url)}">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${attribute(meta.og?.heading || meta.title)}">`,
    `<meta name="twitter:title" content="${attribute(meta.title)}"><meta name="twitter:description" content="${attribute(meta.description)}"><meta name="twitter:image" content="${attribute(image)}">`,
    `<meta name="stillplay-build" content="${build}">`,
    structured ? `<script type="application/ld+json">${JSON.stringify(structured).replaceAll('<', '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n  ');
  let html = template;
  for (const [href, css] of inlined) html = html.replace(`<link rel="stylesheet" href="${href}">`, () => `<style data-href="${href}">${css}</style>`);
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${xml(meta.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${attribute(meta.description)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${attribute(meta.title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${attribute(meta.description)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${attribute(image)}$2`)
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
    .replace('<script type="module"', `${preloads.map((href) => `<link rel="modulepreload" href="${href}">`).join('\n  ')}\n  <script type="module"`)
    .replace('</head>', `  ${head}\n</head>`);
  const out = path === '/' ? join(dist, 'index.html') : join(dist, path, 'index.html');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html);
}

const prerendered = args.includes('--no-prerender') ? 0 : await prerender(dist, paths, createStaticServer);

// ---- 7. sitemap and robots -------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
await writeFile(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${xml(`${origin}${path}`)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
await writeFile(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);

// ---- 8. precompress and record sizes ------------------------------------------------------
const sizes = [];
for (const path of await walk(dist)) {
  if (!['.html', '.js', '.css', '.json', '.wasm', '.svg', '.c', '.xml', '.txt', '.webmanifest'].includes(extname(path))) continue;
  const bytes = await readFile(path);
  const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  await writeFile(`${path}.br`, br);
  await writeFile(`${path}.gz`, gzipSync(bytes, { level: 9 }));
  sizes.push({ path: relative(dist, path), rawBytes: bytes.length, brotliBytes: br.length });
}
await mkdir(join(root, 'notes'), { recursive: true });
await writeFile(join(root, 'notes/payload-sizes.json'), JSON.stringify({ generatedAt: new Date().toISOString(), compiler, buildCommit, build, origin, files: sizes }, null, 2));
console.log(`Built dist (${build}) with ${paths.length} routes (${prerendered} prerendered), ${offline.length} offline files and ${sizes.length} precompressed assets. OG images: ${ogFormat}${ogJobs.length ? ` (${ogJobs.length} rendered)` : ' (cached)'}. Cores: ${compiler}.`);
for (const game of cores) {
  const size = sizes.find((item) => item.path === `cores/${game}.wasm`);
  if (size) console.log(`${game}: ${size.rawBytes} bytes raw; ${size.brotliBytes} bytes Brotli.`);
}
