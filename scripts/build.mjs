import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const compilerCandidates = [process.env.CLANG, 'clang', 'clang-19', '/tmp/stillplay-toolchain/bin/clang'].filter(Boolean);
const compiler = compilerCandidates.find((command) => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0);
if (!compiler) throw new Error('A WebAssembly-capable clang and wasm-ld are required. Set CLANG=/path/to/clang. See README.md.');

for (const game of ['minesweeper', 'freecell']) {
  const result = spawnSync(compiler, [
    '--target=wasm32', '-O2', '-nostdlib', '-fno-builtin', '-Wl,--no-entry', '-Wl,--export-all',
    '-Wl,--strip-all', join(root, 'cores', `${game}.c`), '-o', join(root, 'cores', `${game}.wasm`),
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${game} compilation failed.`);
}
const verify = spawnSync(process.execPath, [join(root, 'scripts/verify-scoreboard.mjs')], { stdio: 'inherit' });
if (verify.status !== 0) throw new Error('Scoreboard evidence checks failed.');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html', 'src', 'cores', 'scoreboard']) await cp(join(root, name), join(dist, name), { recursive: true });
if (existsSync(join(root, 'public'))) await cp(join(root, 'public'), dist, { recursive: true });

const index = await readFile(join(dist, 'index.html'), 'utf8');
const commitResult = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' });
const buildCommit = commitResult.status === 0 && /^[a-f0-9]{40}$/.test(commitResult.stdout.trim()) ? commitResult.stdout.trim() : null;
for (const game of ['minesweeper', 'freecell']) {
  const path = join(dist, 'scoreboard', `${game}.json`);
  const data = JSON.parse(await readFile(path, 'utf8'));
  data.buildCommit = buildCommit;
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
await mkdir(join(dist, 'og'), { recursive: true });
const pages = {
  minesweeper: ['Play Minesweeper online · Stillplay', 'Play Minesweeper in your browser. Beginner, intermediate and expert boards, daily seeds and replay logs.'],
  freecell: ['Play FreeCell online · Stillplay', 'Play numbered FreeCell deals in your browser, including deal 11982. Deterministic C logic compiled to WebAssembly.'],
  scoreboard: ['The reconstruction scoreboard · Stillplay', 'See the verified reconstruction status of Minesweeper and FreeCell. Honest function counts, byte counts and evidence.'],
  about: ['About the project · Stillplay', 'Classic games reconstructed in the open. How we build, verify and create an original visual skin.'],
  secrets: ['Secrets inside the classics · Stillplay', 'Explore the rules, numbered deals and small details behind Minesweeper and FreeCell.'],
  'secrets/first-click': ['Why the first click is safe · Stillplay', 'Try an interactive explanation of first-click safety in our Minesweeper core.'],
  'secrets/xyzzy': ['The XYZZY story · Stillplay', 'The story of a Minesweeper secret, with reconstruction evidence clearly separated from historical context.'],
  'secrets/deal-11982': ['FreeCell deal 11982 · Stillplay', 'Explore the famous FreeCell deal 11982 and the limits of what we have verified.'],
  'secrets/deal-numbers': ['How FreeCell numbers deals · Stillplay', 'Explore the deterministic shuffle behind FreeCell deal numbers.'],
  'daily/minesweeper': ['Daily Minesweeper challenge · Stillplay', 'Play the same deterministic Minesweeper board as everyone else today.'],
  'daily/freecell': ['Daily FreeCell challenge · Stillplay', 'One numbered FreeCell deal per day, shared by every player.'],
};
for (const [path, [title, description]] of Object.entries(pages)) {
  await mkdir(join(dist, path), { recursive: true });
  const html = index.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/, `$1${description}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/?>)/, `$1${title}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/?>)/, `$1${description}$2`)
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*("\s*\/?>)/, `$1/og/${path.replaceAll('/', '-')}.svg$2`);
  await writeFile(join(dist, path, 'index.html'), html);
  const label = title.replace(' · Stillplay', '');
  const lines = label.length > 35 ? [label.slice(0, label.lastIndexOf(' ', 35)), label.slice(label.lastIndexOf(' ', 35) + 1)] : [label];
  await writeFile(join(dist, 'og', `${path.replaceAll('/', '-')}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f7f5ef"/><g fill="#2c6249"><path d="M70 66h22v22H70zM100 66h22v22h-22zM70 96h22v22H70z"/><path d="M100 96h22v22h-22z" fill="none" stroke="#2c6249" stroke-width="2"/></g><text x="142" y="110" font-family="sans-serif" font-size="46" letter-spacing="-2" fill="#2c6249">stillplay.</text><path d="M70 160h1060" stroke="#dcded3"/><text x="70" y="280" font-family="Georgia,serif" font-size="66" letter-spacing="-2" fill="#282e29">${lines.map((line, i) => `<tspan x="70" dy="${i ? 82 : 0}">${xml(line)}</tspan>`).join('')}</text><text x="70" y="510" font-family="sans-serif" font-size="23" fill="#62695e">Playable classics. Original art. Verification in the open.</text><text x="70" y="563" font-family="sans-serif" font-size="19" fill="#62695e">Working prototype · Original-binary verification pending</text></svg>`);
}

const sizes = [];
async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (['.html', '.js', '.css', '.json', '.wasm', '.svg', '.c'].includes(extname(path))) {
      const bytes = await readFile(path);
      const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
      await writeFile(`${path}.br`, br);
      await writeFile(`${path}.gz`, gzipSync(bytes, { level: 9 }));
      sizes.push({ path: path.slice(dist.length + 1), rawBytes: bytes.length, brotliBytes: br.length });
    }
  }
}
await compress(dist);
await mkdir(join(root, 'notes'), { recursive: true });
await writeFile(join(root, 'notes/payload-sizes.json'), JSON.stringify({ generatedAt: new Date().toISOString(), compiler, buildCommit, files: sizes }, null, 2));
console.log(`Built dist with ${sizes.length} precompressed assets using ${compiler}.`);
for (const game of ['minesweeper', 'freecell']) {
  const size = sizes.find((item) => item.path === `cores/${game}.wasm`);
  console.log(`${game}: ${size.rawBytes} bytes raw; ${size.brotliBytes} bytes Brotli.`);
}
