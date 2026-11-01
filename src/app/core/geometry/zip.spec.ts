import { createZip, crc32 } from './zip';

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
describe('PNG download archive', () => {
  it('matches the standard CRC-32 test vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('writes file data and a complete ZIP central directory with valid names and offsets', async () => {
    const data = new TextEncoder().encode('123456789');
    const zip = createZip([
      { name: 'front.png', data },
      { name: 'bottom.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(zip.type).toBe('application/zip');
    const buffer = await readBytes(zip),
      bytes = new Uint8Array(buffer),
      view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0xcbf43926);
    expect(view.getUint32(18, true)).toBe(9);
    expect(new TextDecoder().decode(bytes.slice(30, 39))).toBe('front.png');
    expect(Array.from(bytes.slice(39, 48))).toEqual(Array.from(data));
    expect(view.getUint32(48, true)).toBe(0x04034b50);
    const end = buffer.byteLength - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const central = view.getUint32(end + 16, true);
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint32(central + 16, true)).toBe(0xcbf43926);
    expect(view.getUint32(central + 42, true)).toBe(0);
    expect(view.getUint32(central + 55 + 42, true)).toBe(48);
    expect(central + view.getUint32(end + 12, true)).toBe(end);
  });
});
