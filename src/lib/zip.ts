// Minimal dependency-free ZIP writer (STORE method, no compression).
//
// devX keeps its bundle small and avoids adding npm dependencies, so rather than
// pull in fflate/jszip for the DB "Zip output" export option we emit a valid
// store-only archive by hand. Compression method 0 (stored) is part of the base
// ZIP spec and is accepted by every unzip tool, Finder, and Explorer.
//
// Only the subset of the spec we need is implemented: local file headers, the
// central directory, and the end-of-central-directory record, with CRC-32 over
// each file's bytes. UTF-8 filenames are flagged via the language-encoding bit.

export type ZipEntry = {
  /** Path inside the archive, e.g. "users.sql". */
  name: string;
  /** File contents. Strings are encoded as UTF-8. */
  data: string | Uint8Array;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

/** Build a store-only ZIP archive as a Blob from the given entries. */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes =
      typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(dataBytes);

    // Local file header (30 bytes + name) followed by the stored data.
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50); // local file header signature
    writeUint16(localView, 4, 20); // version needed
    writeUint16(localView, 6, 0x0800); // flags: UTF-8 filename
    writeUint16(localView, 8, 0); // method: stored
    writeUint16(localView, 10, 0); // mod time
    writeUint16(localView, 12, 0); // mod date
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, dataBytes.length); // compressed size
    writeUint32(localView, 22, dataBytes.length); // uncompressed size
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0); // extra field length
    localHeader.set(nameBytes, 30);

    fileParts.push(localHeader, dataBytes);

    // Central directory header (46 bytes + name).
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50); // central dir signature
    writeUint16(centralView, 4, 20); // version made by
    writeUint16(centralView, 6, 20); // version needed
    writeUint16(centralView, 8, 0x0800); // flags: UTF-8 filename
    writeUint16(centralView, 10, 0); // method: stored
    writeUint16(centralView, 12, 0); // mod time
    writeUint16(centralView, 14, 0); // mod date
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, dataBytes.length); // compressed size
    writeUint32(centralView, 24, dataBytes.length); // uncompressed size
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0); // extra field length
    writeUint16(centralView, 32, 0); // comment length
    writeUint16(centralView, 34, 0); // disk number start
    writeUint16(centralView, 36, 0); // internal attributes
    writeUint32(centralView, 38, 0); // external attributes
    writeUint32(centralView, 42, offset); // local header offset
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    centralSize += centralHeader.length;
    offset += localHeader.length + dataBytes.length;
  }

  // End of central directory record (22 bytes).
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50); // EOCD signature
  writeUint16(endView, 4, 0); // disk number
  writeUint16(endView, 6, 0); // central dir disk
  writeUint16(endView, 8, entries.length); // entries on this disk
  writeUint16(endView, 10, entries.length); // total entries
  writeUint32(endView, 12, centralSize); // central dir size
  writeUint32(endView, 16, offset); // central dir offset
  writeUint16(endView, 20, 0); // comment length

  const parts: BlobPart[] = [...fileParts, ...centralParts, end].map(
    (part) => part as unknown as BlobPart,
  );
  return new Blob(parts, { type: "application/zip" });
}
