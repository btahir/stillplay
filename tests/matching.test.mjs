import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { floorPercent, matchManifest } from '../scripts/match.mjs';

// A synthetic PE with our own bytes, not an original game fixture.
function executable(code) {
  const bytes = Buffer.alloc(1024);
  bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(0x80, 0x3c); bytes.writeUInt32LE(0x4550, 0x80);
  bytes.writeUInt16LE(0x14c, 0x84); bytes.writeUInt16LE(1, 0x86); bytes.writeUInt16LE(224, 0x94);
  bytes.writeUInt16LE(0x10b, 0x98); bytes.writeUInt32LE(0x400000, 0xb4);
  bytes.write('.text', 0x178); bytes.writeUInt32LE(512, 0x180); bytes.writeUInt32LE(0x1000, 0x184);
  bytes.writeUInt32LE(512, 0x188); bytes.writeUInt32LE(512, 0x18c); bytes.writeUInt32LE(0x60000020, 0x19c);
  bytes.set(code, 512); return bytes;
}
test('matching compares file-backed bytes, keeps subset coverage unknown and writes only the requested report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stillplay-match-'));
  const repositoryRoot = join(directory, 'repo'), originalsDir = join(directory, 'originals');
  try {
    await mkdir(repositoryRoot); await mkdir(originalsDir);
    const originalExe = join(originalsDir, 'original.exe'), candidateExe = join(directory, 'candidate.exe'), manifestPath = join(directory, 'matching.json');
    await writeFile(originalExe, executable([0x31, 0xc0, 0xc3, 0x90, 1, 2, 3]));
    await writeFile(candidateExe, executable([0x31, 0xc0, 0xc3, 0x90, 1, 8, 3]));
    const manifest = { game: 'minesweeper', originalExe, candidateExe, functions: [{ name: 'our_test_return_zero', originalRva: '0x1000', candidateRva: 4096, size: 3, candidateSize: 3 }, { name: 'our_test_different', originalRva: 4100, candidateRva: 4100, size: 3, candidateSize: 3 }] };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const first = await matchManifest({ manifestPath, originalsDir, repositoryRoot });
    assert.equal(first.report.coverageComplete, false); assert.equal(first.report.matchPercent, null);
    assert.equal(first.report.totalFunctions, null); assert.equal(first.report.matchedFunctions, 1); assert.equal(first.report.matchedBytes, 3);
    assert.equal(first.report.functions[0].address, '0x401000'); assert.equal(first.report.functions[0].evidence.originalSha256, first.report.functions[0].evidence.compiledSha256);
    assert.equal(first.report.functions[1].status, 'non-matching'); assert.equal(first.report.functions[1].similarity, 66.666666);
    assert.equal(first.output, join(repositoryRoot, 'notes', 'matching-minesweeper.json'));
    await assert.rejects(readFile(join(repositoryRoot, 'scoreboard', 'minesweeper.json')), { code: 'ENOENT' });
    manifest.inventory = { exhaustive: true, source: 'Synthetic test fixture contains exactly two declared functions.' };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const outputPath = join(repositoryRoot, 'scoreboard', 'minesweeper.json');
    const complete = await matchManifest({ manifestPath, originalsDir, repositoryRoot, outputPath });
    assert.equal(complete.report.coverageComplete, true); assert.equal(complete.report.matchPercent, 50);
    assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).matchedFunctions, 1);
    const originalReport = await readFile(outputPath, 'utf8');
    manifest.functions[1].originalRva = '0xfffff000'; await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(matchManifest({ manifestPath, originalsDir, repositoryRoot, outputPath }), /file-backed/);
    assert.equal(await readFile(outputPath, 'utf8'), originalReport, 'Invalid ranges must not overwrite an existing report.');
    await assert.rejects(matchManifest({ manifestPath, repositoryRoot, originalsDir: '' }), /Owner input required/);
    manifest.originalExe = join(repositoryRoot, 'must-not-ship.exe'); await writeFile(manifest.originalExe, executable([1])); await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(matchManifest({ manifestPath, originalsDir, repositoryRoot }), /outside the repository/);
    assert.equal(floorPercent(1, 3), 33.333333);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
