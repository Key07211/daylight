import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await fs.readFile(path.join(root, 'public', 'favicon.svg'));
const directory = path.join(root, 'desktop', 'assets');
await fs.mkdir(directory, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()));
await sharp(source).resize(512, 512).png().toFile(path.join(directory, 'icon.png'));
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((data, index) => {
  const position = 6 + index * 16;
  header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], position);
  header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], position + 1);
  header.writeUInt16LE(1, position + 4);
  header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(data.length, position + 8);
  header.writeUInt32LE(offset, position + 12);
  offset += data.length;
});
await fs.writeFile(path.join(directory, 'icon.ico'), Buffer.concat([header, ...images]));
console.log('Desktop icons generated.');
