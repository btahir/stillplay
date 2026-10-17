#!/usr/bin/env node
/** Compare owner-identified function ranges; never obtains binaries or runs them. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TITLES = { minesweeper: 'Minesweeper', freecell: 'FreeCell', solitaire: 'Solitaire', spider: 'Spider Solitaire', hearts: 'Hearts', pinball: '3D Pinball' };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function within(parent, child) { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); }
function uint(value, name, minimum = 0) {
  if (typeof value === 'string' && /^0x[\da-f]+$/i.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < minimum || value > 0xffffffff) throw new Error(`${name} must be a ${minimum ? 'positive' : 'nonnegative'} 32-bit integer or hexadecimal RVA.`);
  return value;
}
/** Six decimal places, truncated; never rounds a decimal percentage upward. */
export function floorPercent(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 1 || numerator > denominator) throw new Error('Invalid percentage counts.');
  return Number(BigInt(numerator) * 100000000n / BigInt(denominator)) / 1000000;
}

export function parsePE(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const check = (offset, size, label) => { if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset > bytes.length - size) throw new Error(`Truncated or invalid ${label}.`); };
  check(0, 64, 'DOS header');
  if (bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Missing MZ executable header.');
  const pe = bytes.readUInt32LE(0x3c); check(pe, 24, 'PE header');
  if (bytes.readUInt32LE(pe) !== 0x4550) throw new Error('Missing PE executable header.');
  const count = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20), optional = pe + 24;
  if (count < 1 || count > 96) throw new Error('Invalid PE section count.');
  check(optional, optionalSize, 'PE optional header');
  if (optionalSize < 2) throw new Error('Missing PE optional header.');
  const magic = bytes.readUInt16LE(optional);
  if ((magic !== 0x10b && magic !== 0x20b) || optionalSize < (magic === 0x10b ? 96 : 112)) throw new Error('Unsupported or truncated PE optional header.');
  const imageBase = magic === 0x10b ? BigInt(bytes.readUInt32LE(optional + 28)) : bytes.readBigUInt64LE(optional + 24);
  const table = optional + optionalSize; check(table, count * 40, 'PE section table');
  const sections = Array.from({ length: count }, (_, index) => {
    const at = table + index * 40;
    const section = { name: bytes.toString('ascii', at, at + 8).replace(/\0.*$/, ''), rva: bytes.readUInt32LE(at + 12), rawSize: bytes.readUInt32LE(at + 16), rawOffset: bytes.readUInt32LE(at + 20), characteristics: bytes.readUInt32LE(at + 36) };
    if (section.rawSize) check(section.rawOffset, section.rawSize, 'file-backed PE section');
    return section;
  });
  return {
    imageBase, machine: bytes.readUInt16LE(pe + 4), linkerVersion: `${bytes[optional + 2]}.${bytes[optional + 3]}`, sections,
    functionBytes(rva, size) {
      const candidates = sections.filter(section => rva >= section.rva && rva - section.rva < section.rawSize && size <= section.rawSize - (rva - section.rva));
      if (candidates.length !== 1) throw new Error('Function RVA does not map unambiguously to one file-backed PE section.');
      const section = candidates[0];
      if (!(section.characteristics & 0x20000000)) throw new Error('Function RVA points to a non-executable PE section.');
      const offset = section.rawOffset + rva - section.rva;
      return bytes.subarray(offset, offset + size);
    },
  };
}

async function fileInput(path, label, limit = 64 * 1024 * 1024) {
  let actual;
  try { actual = await realpath(path); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`Owner input required: ${label} was not found. Supply your own original and a candidate built with a legitimately obtained matching toolchain.`); throw error; }
  const info = await stat(actual);
  if (!info.isFile() || info.size < 1 || info.size > limit) throw new Error(`${label} must be a regular file no larger than ${limit} bytes.`);
  return actual;
}
function noOverlap(functions, rvaKey, sizeKey) {
  const ranges = [...functions].sort((a, b) => a[rvaKey] - b[rvaKey]);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index][rvaKey] < ranges[index - 1][rvaKey] + ranges[index - 1][sizeKey]) throw new Error(`Overlapping ${rvaKey} function ranges would double-count coverage.`);
  }
}

/** All inputs are validated before any report is written. Test callers may supply an isolated root. */
export async function matchManifest({ manifestPath, originalsDir = process.env.XPC_ORIGINALS, outputPath, repositoryRoot = ROOT } = {}) {
  if (!manifestPath) throw new Error('Use --manifest FILE to identify function ranges and the owner-built candidate.');
  if (!originalsDir) throw new Error('Owner input required: set XPC_ORIGINALS to your own originals directory outside the repository. No binaries are downloaded.');
  const root = await realpath(repositoryRoot);
  let originals;
  try { originals = await realpath(resolve(originalsDir)); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('Owner input required: XPC_ORIGINALS does not exist. Supply your own Windows game binaries outside the repository.'); throw error; }
  if (!(await stat(originals)).isDirectory()) throw new Error('XPC_ORIGINALS must name a directory.');
  if (within(root, originals)) throw new Error('XPC_ORIGINALS must be outside the repository.');
  const manifestFile = await fileInput(resolve(manifestPath), 'Matching manifest', 1024 * 1024);
  if (within(root, manifestFile)) throw new Error('Keep the matching manifest outside the repository; it contains local binary paths.');
  const manifestBytes = await readFile(manifestFile);
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('Matching manifest must be valid JSON.'); }
  if (!manifest || typeof manifest !== 'object' || !TITLES[manifest.game]) throw new Error('Manifest must identify a supported game.');
  if (typeof manifest.originalExe !== 'string' || typeof manifest.candidateExe !== 'string') throw new Error('Manifest requires originalExe and candidateExe file paths.');
  const originalFile = await fileInput(resolve(dirname(manifestFile), manifest.originalExe), 'Original executable');
  const candidateFile = await fileInput(resolve(dirname(manifestFile), manifest.candidateExe), 'Candidate executable');
  if (within(root, originalFile) || within(root, candidateFile)) throw new Error('Original and candidate executables must stay outside the repository.');
  if (!within(originals, originalFile)) throw new Error('The original executable must resolve inside XPC_ORIGINALS.');
  if (originalFile === candidateFile) throw new Error('Original and candidate must be different files.');
  if (!Array.isArray(manifest.functions) || manifest.functions.length < 1 || manifest.functions.length > 100000) throw new Error('Manifest requires 1–100,000 identified function ranges.');
  const names = new Set();
  const ranges = manifest.functions.map((entry, index) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 256 || names.has(entry.name)) throw new Error(`Function ${index} requires a unique nonempty name.`);
    names.add(entry.name);
    const range = { name: entry.name, originalRva: uint(entry.originalRva, 'originalRva'), candidateRva: uint(entry.candidateRva, 'candidateRva'), size: uint(entry.size, 'size', 1), candidateSize: uint(entry.candidateSize, 'candidateSize', 1) };
    if (range.originalRva + range.size > 0x100000000 || range.candidateRva + range.candidateSize > 0x100000000) throw new Error('Function range exceeds the RVA address space.');
    return range;
  });
  noOverlap(ranges, 'originalRva', 'size'); noOverlap(ranges, 'candidateRva', 'candidateSize');
  if (manifest.inventory?.exhaustive !== undefined && typeof manifest.inventory.exhaustive !== 'boolean') throw new Error('inventory.exhaustive must be explicitly true or false.');
  const coverageComplete = manifest.inventory?.exhaustive === true;
  if (coverageComplete && (typeof manifest.inventory.source !== 'string' || !manifest.inventory.source.trim())) throw new Error('An exhaustive inventory requires inventory.source describing how original function boundaries were established.');
  if (manifest.buildCommit !== undefined && manifest.buildCommit !== null && !/^[a-f0-9]{7,40}$/.test(manifest.buildCommit)) throw new Error('buildCommit must be a git hash or null.');
  const [original, candidate] = await Promise.all([readFile(originalFile), readFile(candidateFile)]);
  const originalPE = parsePE(original), candidatePE = parsePE(candidate);
  if (originalPE.machine !== candidatePE.machine) throw new Error('Original and candidate PE machine architectures differ.');
  const originalBinarySha256 = sha256(original), compiledBinarySha256 = sha256(candidate);
  const functions = ranges.map(range => {
    const originalBytes = originalPE.functionBytes(range.originalRva, range.size);
    const compiledBytes = candidatePE.functionBytes(range.candidateRva, range.candidateSize);
    const matched = originalBytes.equals(compiledBytes);
    let equalBytes = 0;
    for (let index = 0; index < Math.min(originalBytes.length, compiledBytes.length); index++) if (originalBytes[index] === compiledBytes[index]) equalBytes++;
    return {
      name: range.name, address: `0x${(originalPE.imageBase + BigInt(range.originalRva)).toString(16)}`, candidateAddress: `0x${(candidatePE.imageBase + BigInt(range.candidateRva)).toString(16)}`,
      originalRva: `0x${range.originalRva.toString(16)}`, candidateRva: `0x${range.candidateRva.toString(16)}`, size: range.size, candidateSize: range.candidateSize,
      status: matched ? 'matched' : 'non-matching', similarity: floorPercent(equalBytes, Math.max(range.size, range.candidateSize)),
      evidence: { kind: 'byte-comparison', originalSha256: sha256(originalBytes), compiledSha256: sha256(compiledBytes), originalBinarySha256, compiledBinarySha256 },
    };
  });
  const matched = functions.filter(entry => entry.status === 'matched');
  const matchedBytes = matched.reduce((sum, entry) => sum + entry.size, 0), mappedBytes = functions.reduce((sum, entry) => sum + entry.size, 0);
  const report = {
    schemaVersion: 1, game: manifest.game, title: TITLES[manifest.game], status: coverageComplete ? matched.length === functions.length ? 'matched' : 'matching-in-progress' : 'partial-inventory',
    coverageComplete, inventorySource: manifest.inventory?.source || null,
    matchedFunctions: matched.length, totalFunctions: coverageComplete ? functions.length : null, matchedBytes, totalBytes: coverageComplete ? mappedBytes : null,
    matchPercent: coverageComplete ? floorPercent(matchedBytes, mappedBytes) : null,
    functionMatchPercent: coverageComplete ? floorPercent(matched.length, functions.length) : null,
    mappedFunctionCount: functions.length, mappedBytes, updatedAt: new Date().toISOString().slice(0, 10), buildCommit: manifest.buildCommit || null,
    binaries: { original: { name: basename(originalFile), sha256: originalBinarySha256, linkerVersion: originalPE.linkerVersion }, candidate: { name: basename(candidateFile), sha256: compiledBinarySha256, linkerVersion: candidatePE.linkerVersion } },
    manifestSha256: sha256(manifestBytes), toolchain: manifest.toolchain || null,
    verificationNote: 'Exact bytes are compared without relocation masking or instruction normalization. Function boundaries, exhaustive inventory, candidate provenance, and toolchain provenance are owner-supplied assertions. This report does not establish behavioural equivalence.',
    functions,
  };
  const output = outputPath ? resolve(outputPath) : resolve(root, 'notes', `matching-${manifest.game}.json`);
  // Resolve existing symlinks, including parent directories, before writing.
  let outputActual;
  try { outputActual = await realpath(output); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let parent = dirname(output), suffix = basename(output);
    while (true) {
      try { outputActual = resolve(await realpath(parent), suffix); break; }
      catch (parentError) { if (parentError.code !== 'ENOENT') throw parentError; suffix = resolve('/', basename(parent), suffix).slice(1); const next = dirname(parent); if (next === parent) throw parentError; parent = next; }
    }
  }
  if ([originalFile, candidateFile, manifestFile].includes(outputActual) || within(originals, outputActual)) throw new Error('Report output must not overwrite original inputs, the candidate, or the matching manifest.');
  const publicScoreboard = resolve(root, 'scoreboard');
  if (within(publicScoreboard, outputActual) && outputActual !== resolve(publicScoreboard, `${manifest.game}.json`)) throw new Error('Scoreboard output must be scoreboard/<game>.json for this manifest.');
  const temporary = `${outputActual}.${process.pid}.tmp`;
  await mkdir(dirname(outputActual), { recursive: true });
  try { await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, outputActual); }
  finally { await unlink(temporary).catch(() => {}); }
  return { report, output: outputActual };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  if (args.includes('--help')) { console.log('Usage: XPC_ORIGINALS=/outside/originals pnpm match --manifest /outside/matching.json [--output scoreboard/minesweeper.json]\nDefault output: notes/matching-<game>.json. No originals are downloaded or executed.'); return; }
  for (let index = 0; index < args.length; index++) {
    if (!['--manifest', '--output'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Expected --manifest FILE and optional --output FILE.');
    options[args[index].slice(2)] = args[++index];
  }
  const { report, output } = await matchManifest({ manifestPath: options.manifest, outputPath: options.output });
  console.log(`${report.game}: ${report.matchedFunctions}/${report.mappedFunctionCount} mapped functions match exactly; ${report.matchPercent === null ? 'overall coverage unknown (partial inventory)' : `${report.matchPercent}% of original function bytes matched`}.\nReport: ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(`match: ${error.message}`); process.exitCode = 1; });
