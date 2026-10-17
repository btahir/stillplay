import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pathIndex = args.indexOf('--path');
const suppliedPath = pathIndex >= 0 ? args[pathIndex + 1] : process.env.XPC_ORIGINALS;
const expected = ['winmine.exe', 'freecell.exe', 'sol.exe', 'cards.dll', 'spider.exe', 'mshearts.exe', 'Pinball/pinball.exe', 'Pinball/PINBALL.DAT'];
const report = { inspectedAt: new Date().toISOString(), status: 'awaiting-original', files: [], missing: expected, compiler: null, matchingToolchain: 'Not identified. Owner-supplied originals and a legitimately obtained matching compiler are required.' };
function insideRepository(path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function inspectPE(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') return null;
  const offset = bytes.readUInt32LE(0x3c);
  if (offset + 48 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0') return null;
  const optionalOffset = offset + 24;
  const optionalLength = bytes.readUInt16LE(offset + 20);
  if (optionalOffset + optionalLength > bytes.length || optionalLength < 4) throw new Error('Truncated PE optional header.');
  const richOffset = bytes.indexOf(Buffer.from('Rich'), 64);
  const rich = [];
  if (richOffset >= 64 && richOffset + 8 <= offset) {
    const key = bytes.readUInt32LE(richOffset + 4);
    let dans = -1;
    for (let at = richOffset - 4; at >= 64; at -= 4) {
      if (((bytes.readUInt32LE(at) ^ key) >>> 0) === 0x536e6144) { dans = at; break; }
    }
    if (dans >= 0) for (let at = dans + 16; at + 8 <= richOffset; at += 8) {
      const value = (bytes.readUInt32LE(at) ^ key) >>> 0;
      rich.push({ productId: value >>> 16, buildNumber: value & 0xffff, count: (bytes.readUInt32LE(at + 4) ^ key) >>> 0 });
    }
  }
  return {
    machine: `0x${bytes.readUInt16LE(offset + 4).toString(16)}`,
    sectionCount: bytes.readUInt16LE(offset + 6),
    timeDateStamp: bytes.readUInt32LE(offset + 8),
    optionalHeaderMagic: `0x${bytes.readUInt16LE(optionalOffset).toString(16)}`,
    linkerVersion: `${bytes[optionalOffset + 2]}.${bytes[optionalOffset + 3]}`,
    richHeader: rich.length ? rich : null,
    compilerIdentification: 'Header metadata only; this does not establish the original compiler or flags.',
  };
}
if (suppliedPath) {
  const originals = await realpath(resolve(suppliedPath));
  if (insideRepository(originals)) throw new Error('Keep original files outside the repository. Point XPC_ORIGINALS to that directory.');
  report.missing = [];
  for (const name of expected) {
    let path;
    try { path = await realpath(join(originals, name)); }
    catch (error) { if (error.code === 'ENOENT') { report.missing.push(name); continue; } throw error; }
    if (insideRepository(path)) throw new Error(`Original ${name} resolves inside the repository.`);
    const info = await stat(path);
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error(`Unexpected original input size or type: ${name}`);
    const bytes = await readFile(path);
    report.files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pe: inspectPE(bytes) });
  }
  if (report.files.length) {
    report.status = report.missing.length ? 'partial-inputs' : 'inputs-inspected';
    const manifest = { schemaVersion: 1, inspectedAt: report.inspectedAt, files: report.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })) };
    await writeFile(join(root, 'originals-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}
await mkdir(join(root, 'notes'), { recursive: true });
await writeFile(join(root, 'notes/originals-inspection.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report.files.length ? `Inspected ${report.files.length} owner-supplied files; SHA-256 records saved to originals-manifest.json.` : 'Owner input required: set XPC_ORIGINALS to an outside-repository folder containing your own Windows XP game files. No binaries were downloaded or hashes invented.');
if (report.missing.length) console.log(`Missing: ${report.missing.join(', ')}`);
console.log(report.matchingToolchain);
