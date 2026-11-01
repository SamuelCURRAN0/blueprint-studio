/** A small ZIP writer using stored entries: PNG data is already compressed. */
export interface ArchiveFile {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(files: ArchiveFile[]): Blob {
  const entries: BlobPart[] = [],
    directory: BlobPart[] = [];
  let offset = 0,
    directorySize = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name),
      checksum = crc32(file.data);
    const local = new Uint8Array(30 + name.length),
      header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 file names.
    header.setUint16(12, 33, true); // 1980-01-01, a valid DOS date.
    header.setUint32(14, checksum, true);
    header.setUint32(18, file.data.length, true);
    header.setUint32(22, file.data.length, true);
    header.setUint16(26, name.length, true);
    local.set(name, 30);
    entries.push(local, file.data);

    const central = new Uint8Array(46 + name.length),
      record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(14, 33, true);
    record.setUint32(16, checksum, true);
    record.setUint32(20, file.data.length, true);
    record.setUint32(24, file.data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);
    directorySize += central.length;
    offset += local.length + file.data.length;
  }
  const end = new Uint8Array(22),
    footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, files.length, true);
  footer.setUint16(10, files.length, true);
  footer.setUint32(12, directorySize, true);
  footer.setUint32(16, offset, true);
  return new Blob([...entries, ...directory, end], { type: 'application/zip' });
}
