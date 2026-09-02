// A zip archive, written by hand.
//
// Node ships deflate but no archive format, and a bundle a person downloads is
// one file. The format is small enough to write here — local headers, the
// entries, a central directory, an end record — and owning it means the editor
// pulls in no dependency to hand a graph to someone else.

import { deflateRawSync } from 'node:zlib';

export interface ZipEntry { path: string; content: Buffer }

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, the only clock the format has. */
function dosDateTime(date: Date): { date: number; time: number } {
  return {
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

function u16(n: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

/** The archive holding *entries*, each deflated, in the order given. */
export function zip(entries: ZipEntry[], now = new Date()): Buffer {
  const { date, time } = dosDateTime(now);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/\\/g, '/'), 'utf8');
    const packed = deflateRawSync(entry.content);
    const crc = crc32(entry.content);
    const common = Buffer.concat([
      u16(20), u16(0x0800), u16(8), u16(time), u16(date),
      u32(crc), u32(packed.length), u32(entry.content.length), u16(name.length),
    ]);
    const local = Buffer.concat([u32(0x04034b50), common, u16(0), name, packed]);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    locals.push(local);
    offset += local.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, directory, end]);
}
