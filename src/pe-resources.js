/** Local, read-only Windows PE resource inspection. No network APIs are used here. */
const RESOURCE_TYPES = { 1: 'cursor', 2: 'bitmap', 3: 'icon', 4: 'menu', 5: 'dialog', 6: 'string', 10: 'raw', 12: 'group-cursor', 14: 'group-icon', 16: 'version', 24: 'manifest' };
const MAX_RESOURCE_NODES = 8192;

function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected an ArrayBuffer or typed array.');
}

/** Parse only PE headers and resources; this never executes the supplied program. */
export function extractPEResources(input) {
  const bytes = bytesOf(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ensure = (offset, length, label = 'PE structure') => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > bytes.length - length) throw new Error(`Invalid or truncated ${label}.`);
  };
  const u16 = (offset) => { ensure(offset, 2); return view.getUint16(offset, true); };
  const u32 = (offset) => { ensure(offset, 4); return view.getUint32(offset, true); };
  ensure(0, 64, 'DOS header');
  if (u16(0) !== 0x5a4d) throw new Error('This is not a Windows executable (missing MZ header).');
  const pe = u32(0x3c);
  ensure(pe, 24, 'PE header');
  if (u32(pe) !== 0x00004550) throw new Error('This is not a PE executable.');
  const sectionCount = u16(pe + 6);
  if (sectionCount < 1 || sectionCount > 96) throw new Error('Invalid PE section count.');
  const optionalSize = u16(pe + 20);
  const optional = pe + 24;
  ensure(optional, optionalSize, 'PE optional header');
  const magic = u16(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('Unsupported PE optional header.');
  const directoryOffset = magic === 0x10b ? 96 : 112;
  if (optionalSize < directoryOffset) throw new Error('Truncated PE optional header.');
  const directoryCount = u32(optional + directoryOffset - 4);
  const sectionTable = optional + optionalSize;
  ensure(sectionTable, sectionCount * 40, 'PE section table');
  const decoder = new TextDecoder('utf-8');
  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const offset = sectionTable + i * 40;
    const rawSize = u32(offset + 16), rawOffset = u32(offset + 20);
    if (rawSize) ensure(rawOffset, rawSize, 'PE section data');
    return { name: decoder.decode(bytes.subarray(offset, offset + 8)).replace(/\0.*$/, ''), virtualSize: u32(offset + 8), rva: u32(offset + 12), rawSize, rawOffset };
  });
  const rvaOffset = (rva, length) => {
    const section = sections.find((part) => rva >= part.rva && rva - part.rva <= part.rawSize && length <= part.rawSize - (rva - part.rva));
    if (!section) throw new Error('Resource points outside file-backed PE sections.');
    const offset = section.rawOffset + rva - section.rva;
    ensure(offset, length, 'resource data');
    return offset;
  };
  const metadata = {
    machine: u16(pe + 4), machineName: ({ 332: 'x86', 34404: 'x86-64', 43620: 'ARM64' })[u16(pe + 4)] || 'unknown',
    timestamp: u32(pe + 8), linkerVersion: `${bytes[optional + 2]}.${bytes[optional + 3]}`,
    format: magic === 0x10b ? 'PE32' : 'PE32+', size: bytes.length, sections,
    // A linker version is evidence, not a definitive compiler identification.
    compiler: 'Unidentified; linker metadata alone does not establish the compiler.',
  };
  if (directoryCount < 3) return { metadata, resources: [] };
  if (optionalSize < directoryOffset + 24) throw new Error('Missing PE resource data directory.');
  const rootRva = u32(optional + directoryOffset + 16);
  const rootSize = u32(optional + directoryOffset + 20);
  if (!rootRva || !rootSize) return { metadata, resources: [] };
  const root = rvaOffset(rootRva, rootSize);
  const inside = (relative, length) => {
    if (!Number.isSafeInteger(relative) || relative < 0 || relative > rootSize - length) throw new Error('Resource directory points outside its declared bounds.');
    ensure(root + relative, length, 'resource directory');
    return root + relative;
  };
  const nameAt = (field) => {
    if (!(field & 0x80000000)) return field;
    const relative = field & 0x7fffffff;
    const position = inside(relative, 2);
    const length = u16(position);
    inside(relative + 2, length * 2);
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(position + 2, position + 2 + length * 2));
  };
  const resources = [];
  let nodes = 0;
  const walk = (relative, path, ancestors) => {
    if (path.length > 8 || ancestors.has(relative)) throw new Error('Cyclic or excessively nested PE resource directory.');
    if (++nodes > MAX_RESOURCE_NODES) throw new Error('PE resource directory is too large.');
    const directory = inside(relative, 16);
    const count = u16(directory + 12) + u16(directory + 14);
    const entries = inside(relative + 16, count * 8);
    const nextAncestors = new Set(ancestors).add(relative);
    for (let index = 0; index < count; index++) {
      if (++nodes > MAX_RESOURCE_NODES) throw new Error('PE resource directory is too large.');
      const entry = entries + index * 8;
      const name = nameAt(u32(entry));
      const child = u32(entry + 4);
      const nextPath = [...path, name];
      if (child & 0x80000000) {
        walk(child & 0x7fffffff, nextPath, nextAncestors);
      } else {
        const dataEntry = inside(child, 16);
        const size = u32(dataEntry + 4);
        const offset = rvaOffset(u32(dataEntry), size);
        resources.push({ type: nextPath[0], typeName: RESOURCE_TYPES[nextPath[0]] || String(nextPath[0]), id: nextPath[1] ?? null, language: nextPath[2] ?? null, path: nextPath, size, codepage: u32(dataEntry + 8), data: bytes.slice(offset, offset + size) });
      }
    }
  };
  walk(0, [], new Set());
  return { metadata, resources };
}

/** Wrap an RT_BITMAP DIB in a BMP file header; no image pixels are modified. */
export function dibToBmp(input) {
  const bytes = bytesOf(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12) throw new Error('Truncated bitmap header.');
  const headerSize = view.getUint32(0, true);
  if (![12, 40, 52, 56, 108, 124].includes(headerSize) || headerSize > bytes.length) throw new Error('Unsupported or truncated DIB header.');
  const core = headerSize === 12;
  const width = core ? view.getUint16(4, true) : view.getInt32(4, true);
  const height = core ? view.getUint16(6, true) : view.getInt32(8, true);
  const planes = view.getUint16(core ? 8 : 12, true);
  const bitsPerPixel = view.getUint16(core ? 10 : 14, true);
  const compression = core ? 0 : view.getUint32(16, true);
  if (width < 1 || height === 0 || Math.abs(height) > 32768 || width > 32768 || planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(bitsPerPixel)) throw new Error('Invalid bitmap dimensions or pixel format.');
  if (![0, 3, 6].includes(compression) || (compression && ![16, 32].includes(bitsPerPixel))) throw new Error('Only uncompressed and bitfield bitmap resources are supported.');
  const usedColors = core ? 0 : view.getUint32(32, true);
  const colors = usedColors || (bitsPerPixel <= 8 ? 2 ** bitsPerPixel : 0);
  if (colors > 256 || (bitsPerPixel <= 8 && colors > 2 ** bitsPerPixel)) throw new Error('Invalid bitmap palette size.');
  const masks = headerSize === 40 ? (compression === 3 ? 12 : compression === 6 ? 16 : 0) : 0;
  const pixelOffset = headerSize + masks + colors * (core ? 3 : 4);
  const rowBytes = Math.ceil(width * bitsPerPixel / 32) * 4;
  if (pixelOffset > bytes.length || rowBytes * Math.abs(height) > bytes.length - pixelOffset) throw new Error('Truncated bitmap palette or pixel data.');
  const bmp = new Uint8Array(bytes.length + 14);
  const out = new DataView(bmp.buffer);
  out.setUint16(0, 0x4d42, true);
  out.setUint32(2, bmp.length, true);
  out.setUint32(10, 14 + pixelOffset, true);
  bmp.set(bytes, 14);
  return { bmp, width, height: Math.abs(height), topDown: height < 0, bitsPerPixel, compression };
}

/** Candidate mappings are based on dimensions. Verify resource IDs against your own binary. */
export function findMinesweeperAssets(bitmaps) {
  const strip = (item, cellWidth, cellHeight, minCount) => (item.width === cellWidth && item.height % cellHeight === 0 && item.height / cellHeight >= minCount) || (item.height === cellHeight && item.width % cellWidth === 0 && item.width / cellWidth >= minCount);
  const describe = (item, cellWidth, cellHeight) => item ? { ...item, cellWidth, cellHeight, direction: item.width === cellWidth ? 'vertical' : 'horizontal', count: item.width === cellWidth ? item.height / cellHeight : item.width / cellWidth } : null;
  return {
    tiles: describe(bitmaps.find((item) => strip(item, 16, 16, 12)), 16, 16),
    faces: describe(bitmaps.find((item) => strip(item, 26, 26, 3)), 26, 26),
    digits: describe(bitmaps.find((item) => strip(item, 13, 23, 10)), 13, 23),
    verified: false,
    warning: 'Resource strips are identified by dimensions. Their frame ordering has not been verified against an owner-supplied original. Original pixels uses our own pixel art until a verified mapping is available.',
  };
}

/** Inspect and hash an owner-selected file in this browser. Never uploads or executes it. */
export async function inspectExecutable(input) {
  const bytes = bytesOf(input);
  const result = extractPEResources(bytes);
  if (!globalThis.crypto?.subtle) throw new Error('Local SHA-256 requires a secure browser context (HTTPS or localhost).');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const bitmaps = [], warnings = [];
  for (const resource of result.resources) {
    if (resource.type !== 2) continue;
    try { bitmaps.push({ id: resource.id, language: resource.language, ...dibToBmp(resource.data) }); }
    catch (error) { warnings.push(`Bitmap ${resource.id}: ${error.message}`); }
  }
  return { ...result, sha256, bitmaps, minesweeper: findMinesweeperAssets(bitmaps), warnings };
}
