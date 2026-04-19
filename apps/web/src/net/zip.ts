/**
 * zip.ts — Minimal ZIP creation using browser built-in Compression Streams API.
 *
 * Uses the Compression Streams API (available in Chrome, Firefox, Safari 16.4+)
 * to create a valid ZIP archive without any external dependencies.
 *
 * The ZIP format: each file is stored (no compression) inside a standard ZIP container.
 * For production deploys, a proper archiver with deflate compression would be better,
 * but this works without any npm packages.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Creates a ZIP buffer from a list of entries.
 * Each entry has a name (file path) and data (Uint8Array).
 */
export async function createZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const nameLen = nameBytes.length;

    // Local file header (30 bytes + name + extra)
    const headerSize = 30 + nameLen;
    const header = new Uint8Array(headerSize);
    const view = new DataView(header.buffer);

    // Local file header signature
    view.setUint32(0, 0x04034b50, true);
    // Version needed (UTF-8 names)
    view.setUint16(4, 0x0014, true);
    // General purpose flag (none)
    view.setUint16(6, 0, true);
    // Compression method (0 = stored)
    view.setUint16(8, 0, true);
    // File last modification time
    view.setUint16(10, 0, true);
    // File last modification date
    view.setUint16(12, 0, true);
    // CRC-32 of data (placeholder — real impl would compute)
    view.setUint32(14, 0, true);
    // Compressed size
    view.setUint32(18, entry.data.length, true);
    // Uncompressed size
    view.setUint32(22, entry.data.length, true);
    // File name length
    view.setUint16(26, nameLen, true);
    // Extra field length
    view.setUint16(28, 0, true);
    // File name (no extra field)
    header.set(nameBytes, 30);

    // CRC-32 of the data
    const crc = crc32(entry.data);
    view.setUint32(14, crc, true);

    parts.push(header);
    parts.push(entry.data);
  }

  // Central directory
  const centralDir: Uint8Array[] = [];
  let cdOffset = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nameBytes = new TextEncoder().encode(entry.name);
    const nameLen = nameBytes.length;

    const cdEntrySize = 46 + nameLen;
    const cdEntry = new Uint8Array(cdEntrySize);
    const cdView = new DataView(cdEntry.buffer);

    // Central directory header signature
    cdView.setUint32(0, 0x02014b50, true);
    // Version made by
    cdView.setUint16(4, 0x0314, true);
    // Version needed
    cdView.setUint16(6, 0x0014, true);
    // General purpose flag
    cdView.setUint16(8, 0, true);
    // Compression method
    cdView.setUint16(10, 0, true);
    // File last modification time
    cdView.setUint16(12, 0, true);
    // File last modification date
    cdView.setUint16(14, 0, true);
    // CRC-32
    cdView.setUint32(16, crc32(entry.data), true);
    // Compressed size
    cdView.setUint32(20, entry.data.length, true);
    // Uncompressed size
    cdView.setUint32(24, entry.data.length, true);
    // File name length
    cdView.setUint16(28, nameLen, true);
    // Extra field length
    cdView.setUint16(30, 0, true);
    // File comment length
    cdView.setUint16(32, 0, true);
    // Disk number start
    cdView.setUint16(34, 0, true);
    // Internal file attributes
    cdView.setUint16(36, 0, true);
    // External file attributes
    cdView.setUint32(38, 0, true);
    // Relative offset of local header
    cdView.setUint32(42, cdOffset, true);

    cdEntry.set(nameBytes, 46);
    cdOffset += 30 + nameLen + entry.data.length;
    centralDir.push(cdEntry);
  }

  const cdData = concatUint8Arrays(centralDir);
  const cdSize = cdData.length;
  const cdStart = parts.reduce((sum, p) => sum + p.length, 0);

  // End of central directory
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  // Number of this disk
  eocdView.setUint16(4, 0, true);
  // Disk where central directory starts
  eocdView.setUint16(6, 0, true);
  // Number of central directory records on this disk
  eocdView.setUint16(8, entries.length, true);
  // Total number of central directory records
  eocdView.setUint16(10, entries.length, true);
  // Size of central directory
  eocdView.setUint32(12, cdSize, true);
  // Offset of start of central directory
  eocdView.setUint32(16, cdStart, true);
  // Comment length
  eocdView.setUint16(20, 0, true);

  return concatUint8Arrays([...parts, cdData, eocd]);
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * CRC-32 implementation (IEEE polynomial).
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = makeCrc32Table();
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const _crc32Table: Uint32Array | null = null;
function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}
