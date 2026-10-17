import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dibToBmp, extractPEResources, findMinesweeperAssets, inspectExecutable } from '../src/pe-resources.js';

function bitmap(width = 2, height = 2, bits = 24) {
  const colors = bits <= 8 ? 2 ** bits : 0;
  const bytes = new Uint8Array(40 + colors * 4 + Math.ceil(width * bits / 32) * 4 * Math.abs(height));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 40, true); view.setInt32(4, width, true); view.setInt32(8, height, true); view.setUint16(12, 1, true); view.setUint16(14, bits, true);
  return bytes;
}
function executable() {
  const bytes = new Uint8Array(1024), view = new DataView(bytes.buffer);
  const put16 = (offset, value) => view.setUint16(offset, value, true);
  const put32 = (offset, value) => view.setUint32(offset, value, true);
  put16(0, 0x5a4d); put32(0x3c, 0x80); put32(0x80, 0x4550);
  put16(0x84, 0x14c); put16(0x86, 1); put16(0x94, 224);
  put16(0x98, 0x10b); bytes[0x9a] = 6; put32(0xf4, 16);
  put32(0x108, 0x1000); put32(0x10c, 128);
  bytes.set(new TextEncoder().encode('.rsrc'), 0x178); put32(0x180, 512); put32(0x184, 0x1000); put32(0x188, 512); put32(0x18c, 512);
  put16(0x20e, 1); put32(0x210, 2); put32(0x214, 0x80000018);
  put16(0x226, 1); put32(0x228, 430); put32(0x22c, 0x80000030);
  put16(0x23e, 1); put32(0x240, 1033); put32(0x244, 72);
  const dib = bitmap(); put32(0x248, 0x1100); put32(0x24c, dib.length); bytes.set(dib, 0x300);
  return bytes;
}

test('extracts a file-backed RT_BITMAP without executing a PE', () => {
  const { metadata, resources } = extractPEResources(executable());
  assert.equal(metadata.machineName, 'x86'); assert.equal(metadata.linkerVersion, '6.0');
  assert.equal(resources.length, 1); assert.equal(resources[0].typeName, 'bitmap');
  assert.equal(resources[0].id, 430); assert.equal(resources[0].language, 1033);
  assert.deepEqual([...resources[0].data], [...bitmap()]);
});
test('handles typed-array views and hashes exactly the selected file bytes locally', async () => {
  const original = executable(), padded = new Uint8Array(original.length + 16); padded.set(original, 8);
  const input = padded.subarray(8, padded.length - 8);
  const result = await inspectExecutable(input);
  assert.equal(result.sha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(result.bitmaps[0].width, 2); assert.equal(result.bitmaps[0].height, 2);
  assert.equal(result.minesweeper.verified, false);
});
test('rejects truncated headers, out-of-file sections and malformed resource trees', () => {
  assert.throws(() => extractPEResources(new Uint8Array(2)), /truncated/i);
  const outside = executable(); new DataView(outside.buffer).setUint32(0x18c, 1000, true);
  assert.throws(() => extractPEResources(outside), /section data/i);
  const cyclic = executable(); new DataView(cyclic.buffer).setUint32(0x214, 0x80000000, true);
  assert.throws(() => extractPEResources(cyclic), /cyclic/i);
  const directoryOutside = executable(); new DataView(directoryOutside.buffer).setUint32(0x214, 0x80000200, true);
  assert.throws(() => extractPEResources(directoryOutside), /bounds/i);
  const dataOutside = executable(); new DataView(dataOutside.buffer).setUint32(0x248, 0xfffffff0, true);
  assert.throws(() => extractPEResources(dataOutside), /file-backed/i);
});
test('wraps both RGB and indexed DIB resources with correct BMP pixel offsets', () => {
  const rgb = dibToBmp(bitmap());
  assert.equal(new DataView(rgb.bmp.buffer).getUint32(10, true), 54);
  const indexed = dibToBmp(bitmap(16, 16, 4));
  assert.equal(new DataView(indexed.bmp.buffer).getUint32(10, true), 118);
  assert.equal(indexed.bitsPerPixel, 4);
  const topDown = dibToBmp(bitmap(4, -3)); assert.equal(topDown.height, 3); assert.equal(topDown.topDown, true);
  assert.throws(() => dibToBmp(bitmap().subarray(0, 44)), /truncated/i);
});
test('identifies strip dimensions without claiming original-resource fidelity', () => {
  const assets = findMinesweeperAssets([{ id: 1, width: 16, height: 256 }, { id: 2, width: 130, height: 26 }, { id: 3, width: 13, height: 276 }]);
  assert.equal(assets.tiles.count, 16); assert.equal(assets.tiles.direction, 'vertical');
  assert.equal(assets.faces.direction, 'horizontal'); assert.equal(assets.digits.count, 12);
  assert.equal(assets.verified, false); assert.match(assets.warning, /not been verified/);
});
