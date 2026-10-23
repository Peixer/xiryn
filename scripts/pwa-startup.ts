import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

import { pwaStartupImages, pwaThemeColorDark } from "../lib/pwa"

function crc32(buf: Buffer) {
  let crc = ~0
  for (const byte of buf) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return ~crc >>> 0
}

function chunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, checksum])
}

function png(width: number, height: number) {
  const background = [0x14, 0x15, 0x1a]
  const mark = [0xbf, 0xe2, 0xff]
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  const solid = Buffer.alloc(width * 3)
  for (let x = 0; x < width; x++) {
    solid[x * 3] = background[0]
    solid[x * 3 + 1] = background[1]
    solid[x * 3 + 2] = background[2]
  }
  for (let y = 0; y < height; y++) solid.copy(raw, y * stride + 1)
  const cx = Math.floor(width / 2)
  const cy = Math.floor(height / 2)
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const offset = y * stride + 1 + x * 3
    raw[offset] = mark[0]
    raw[offset + 1] = mark[1]
    raw[offset + 2] = mark[2]
  }
  for (let y = cy - 90; y <= cy + 90; y++) {
    for (let x = cx - 90; x <= cx + 90; x++) {
      const dx = x - cx
      const dy = y - cy
      const ring = dx * dx + dy * dy
      const dot =
        (dx + 18) ** 2 + (dy + 10) ** 2 < 36 ||
        dx * dx + (dy - 8) ** 2 < 22 ||
        (dx - 20) ** 2 + (dy - 26) ** 2 < 48
      const onRing = ring > 70 * 70 && ring < 78 * 78 && dx < 40
      if (dot || onRing) paint(x, y)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const directory = path.join(process.cwd(), "public", "startup")
fs.mkdirSync(directory, { recursive: true })
for (const image of pwaStartupImages) {
  const file = path.join(process.cwd(), "public", image.href.slice(1))
  fs.writeFileSync(file, png(image.width, image.height))
  console.log(image.href, fs.statSync(file).size)
}
console.log("theme", pwaThemeColorDark)
