import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = /^[a-f0-9]{64}$/;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
for (const game of ['minesweeper', 'freecell']) {
  const board = JSON.parse(await readFile(join(root, 'scoreboard', `${game}.json`), 'utf8'));
  const check = (condition, message) => assert.ok(condition, `${game}: ${message}`);
  check(board.game === game && typeof board.title === 'string', 'game and title must identify this scoreboard');
  check(Array.isArray(board.functions), 'functions must be an array');
  check(/^\d{4}-\d{2}-\d{2}$/.test(board.updatedAt), 'updatedAt must be a date');
  check(board.buildCommit === null || /^[a-f0-9]{7,40}$/.test(board.buildCommit), 'buildCommit must be a real hash or null');
  check(count(board.matchedFunctions) && count(board.matchedBytes), 'matched counts must be nonnegative integers');
  const matched = board.functions.filter((item) => item.status === 'matched');
  check(board.matchedFunctions === matched.length, 'matchedFunctions must equal the function records');
  check(board.matchedBytes === matched.reduce((sum, item) => sum + item.size, 0), 'matchedBytes must equal the matched function sizes');
  if (board.totalFunctions === null || board.totalBytes === null) {
    check(board.totalFunctions === null && board.totalBytes === null && board.matchPercent === null, 'unknown totals must keep the percentage unknown');
    if (board.status === 'awaiting-original') {
      check(board.matchedFunctions === 0 && board.matchedBytes === 0 && board.functions.length === 0, 'awaiting originals must not contain invented matched functions');
    } else {
      check(board.status === 'partial-inventory' && board.coverageComplete === false, 'unknown totals require an explicitly partial inventory');
      check(board.functions.length > 0 && board.mappedFunctionCount === board.functions.length, 'partial inventory must identify its mapped function count');
      check(board.mappedBytes === board.functions.reduce((sum, item) => sum + item.size, 0), 'partial inventory must identify its mapped byte count');
      check(board.functionMatchPercent === null, 'partial inventory cannot claim an overall function percentage');
    }
  } else {
    check(board.coverageComplete === true && typeof board.inventorySource === 'string' && board.inventorySource.length > 0, 'known overall coverage requires an explicitly exhaustive original inventory');
    check(count(board.totalFunctions) && board.totalFunctions > 0 && count(board.totalBytes) && board.totalBytes > 0, 'known original totals must be positive');
    check(board.totalFunctions === board.functions.length, 'known total function count must equal the mapped function records');
    check(board.totalBytes === board.functions.reduce((sum, item) => sum + item.size, 0), 'known total bytes must equal the mapped sizes');
    const exact = 100 * board.matchedBytes / board.totalBytes;
    check(Number.isFinite(board.matchPercent) && board.matchPercent >= 0 && board.matchPercent <= exact, 'percentage cannot round up or exceed matched original bytes');
    check(exact - board.matchPercent < 0.11, 'percentage must describe the byte ratio accurately');
  }
  const addresses = new Set();
  for (const item of board.functions) {
    check(typeof item.name === 'string' && item.name.length > 0, 'each mapped function requires a name');
    check(/^0x[a-f0-9]+$/i.test(item.address), 'each mapped function requires an original address');
    check(!addresses.has(item.address.toLowerCase()), 'original addresses must be unique');
    addresses.add(item.address.toLowerCase());
    check(count(item.size) && item.size > 0, 'mapped function sizes must be positive');
    check(['matched', 'non-matching', 'not-started', 'behaviour-verified'].includes(item.status), 'function status must be explicit');
    if (['matched', 'non-matching'].includes(item.status)) {
      check(item.evidence?.kind === 'byte-comparison' && hash.test(item.evidence.originalSha256) && hash.test(item.evidence.compiledSha256) && hash.test(item.evidence.originalBinarySha256), 'byte comparison requires actual original and candidate function hashes and an original binary hash');
    }
    if (item.status === 'matched') {
      check(item.evidence?.kind === 'byte-comparison' && hash.test(item.evidence.originalSha256) && hash.test(item.evidence.compiledSha256), 'matched functions require original and compiled byte hashes');
      check(item.evidence.originalSha256 === item.evidence.compiledSha256, 'matched function byte hashes must agree');
      check(item.candidateSize === undefined || item.candidateSize === item.size, 'matched function sizes must agree');
      check(hash.test(item.evidence.originalBinarySha256), 'matched functions require an identified original binary');
    }
    if (item.status === 'behaviour-verified') check(item.evidence?.kind === 'original-differential' && hash.test(item.evidence.originalBinarySha256) && count(item.evidence.comparisons) && item.evidence.comparisons > 0 && item.evidence.differences === 0, 'behaviour verification requires actual comparisons against an identified original binary');
    if (item.status === 'non-matching') check(Number.isFinite(item.similarity) && item.similarity >= 0 && item.similarity < 100, 'non-matching similarity must be below 100');
  }
  console.log(`${game}: ${board.matchPercent === null ? 'byte-match percentage unknown; complete original inventory awaited' : `${board.matchPercent}% byte-matched`} (${board.matchedFunctions} matched functions).`);
}
