// news-image-24nov: draws a one-page newspaper of the five biggest stories of
// 24 November 2026, procedurally, with Node's standard library only.
// Deterministic: two runs produce byte-identical entry.png.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const px = Buffer.alloc(W * H * 4);

const PAPER: number[] = [244, 236, 222];
const INK: number[] = [30, 28, 25];
const RED: number[] = [178, 44, 32];
const BLUE: number[] = [64, 88, 118];

// ---------- PNG encoder ----------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0; // filter: none
    px.copy(raw, y * stride + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- drawing helpers ----------
function setPixel(x: number, y: number, c: number[]): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
}

function fillRect(x: number, y: number, w: number, h: number, c: number[]): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPixel(x + i, y + j, c);
}

function rectOutline(x: number, y: number, w: number, h: number, t: number, c: number[]): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

function hline(x0: number, x1: number, y: number, c: number[]): void {
  for (let x = x0; x <= x1; x++) setPixel(x, y, c);
}

function vline(x: number, y0: number, y1: number, c: number[]): void {
  for (let y = y0; y <= y1; y++) setPixel(x, y, c);
}

function line(x0: number, y0: number, x1: number, y1: number, c: number[]): void {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    setPixel(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: number[]): void {
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt(r * r - dy * dy));
    hline(cx - hw, cx + hw, cy + dy, c);
  }
}

function ring(cx: number, cy: number, r: number, c: number[]): void {
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt(r * r - dy * dy));
    setPixel(cx - hw, cy + dy, c);
    setPixel(cx + hw, cy + dy, c);
  }
}

// filled triangle with a horizontal base (yB) and an apex above (yA <= yB)
function fillTri(x0: number, x1: number, yB: number, ax: number, yA: number, c: number[]): void {
  for (let y = yA; y <= yB; y++) {
    const t = (y - yA) / Math.max(1, yB - yA);
    const xl = Math.floor(ax + (x0 - ax) * t);
    const xr = Math.ceil(ax + (x1 - ax) * t);
    hline(xl, xr, y, c);
  }
}

// zigzag "sea" line across [x0, x1]
function zigzag(x0: number, x1: number, y: number, amp: number, per: number, c: number[]): void {
  for (let x = x0; x <= x1; x++) {
    const yv = y + (Math.floor((x - x0) / per) % 2 === 0 ? -amp : amp);
    setPixel(x, yv, c);
  }
}

function dashLine(x0: number, y0: number, x1: number, y1: number, dash: number, c: number[]): void {
  const len = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0)));
  for (let t = 0; t < len; t++) {
    if (Math.floor(t / dash) % 2 !== 0) continue;
    const x = Math.round(x0 + (x1 - x0) * t / len);
    const y = Math.round(y0 + (y1 - y0) * t / len);
    setPixel(x, y, c);
  }
}

// ---------- 5x7 pixel font (rows top->bottom, 5 bits, MSB left) ----------
const FONT: Record<string, number[]> = {
  'A': [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'B': [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  'C': [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  'D': [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  'E': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  'F': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  'G': [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  'H': [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'I': [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  'M': [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  'O': [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'P': [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  'Q': [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  'R': [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  'S': [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  'T': [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  'X': [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  'Y': [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  'Z': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x06, 0x06],
  ',': [0, 0, 0, 0, 0, 0x06, 0x04],
  ':': [0, 0x06, 0x06, 0, 0x06, 0x06, 0],
  ';': [0, 0, 0, 0, 0, 0x06, 0x04],
  "'": [0x06, 0x04, 0x08, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x0e, 0, 0, 0],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '%': [0x19, 0x1a, 0x02, 0x04, 0x08, 0x13, 0x1c],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(x: number, y: number, s: string, scale: number, c: number[]): void {
  for (let n = 0; n < s.length; n++) {
    const g = FONT[s[n]];
    if (!g) continue;
    for (let r = 0; r < 7; r++) {
      const bits = g[r];
      for (let col = 0; col < 5; col++) {
        if (!(bits & (0x10 >> col))) continue;
        fillRect(x + n * 6 * scale + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

function drawTextCentered(y: number, s: string, scale: number, c: number[]): void {
  drawText(Math.floor((W - textWidth(s, scale)) / 2), y, s, scale, c);
}

// ---------- masthead ----------
function drawMasthead(): void {
  fillRect(0, 0, W, H, PAPER);
  hline(20, 1003, 16, INK);
  hline(20, 1003, 19, INK);
  drawTextCentered(44, 'WORLD NEWS', 5, INK);          // y 44..78
  drawTextCentered(94, '24 NOVEMBER 2026', 6, INK);     // y 94..135
  fillRect(20, 148, 983, 4, INK);
  hline(20, 1003, 158, INK);
}

// ---------- panel frame + caption ----------
const PXL = 20, PXR = 1003, PW = 983;

function drawPanelFrame(i: number, py: number): void {
  rectOutline(PXL, py, PW, 150, 2, INK);
  vline(232, py + 14, py + 136, INK);
  vline(233, py + 14, py + 136, INK);
  fillRect(944, py + 18, 32, 30, INK);
  drawText(956, py + 25, String(i + 1), 2, PAPER);
}

function drawCaptions(py: number, head: string, sub: string): void {
  drawText(252, py + 34, head, 3, INK);
  drawText(252, py + 72, sub, 2, INK);
}

// 1: scales of justice (Huawei verdict)
function drawScales(ox: number, oy: number): void {
  const cx = ox + 88;
  fillCircle(cx, oy + 18, 5, INK);
  fillRect(cx - 2, oy + 23, 4, 82, INK);
  fillRect(cx - 25, oy + 105, 50, 6, INK);
  fillRect(ox + 28, oy + 34, 120, 4, INK);
  for (const s of [30, 146]) {
    line(cx + (s - 88) * 1, oy + 38, ox + s - 14, oy + 74, INK);
    line(cx + (s - 88) * 1, oy + 38, ox + s + 14, oy + 74, INK);
    for (let dy = 0; dy <= 10; dy++) {
      const hw = Math.floor(Math.sqrt(196 - dy * dy));
      hline(ox + s - hw, ox + s + hw, oy + 74 + dy, INK);
    }
  }
}

// 2: cargo ship in the Gulf of Finland, drone strike
function drawShip(ox: number, oy: number): void {
  zigzag(ox + 6, ox + 170, oy + 100, 4, 12, BLUE);
  zigzag(ox + 6, ox + 170, oy + 112, 4, 12, BLUE);
  for (let y = 78; y <= 100; y++) {
    const t = (y - 78) / 22;
    hline(ox + Math.floor(24 + 12 * t), ox + Math.ceil(152 - 12 * t), oy + y, INK);
  }
  fillRect(ox + 56, oy + 64, 22, 14, INK);
  fillRect(ox + 82, oy + 64, 22, 14, INK);
  fillRect(ox + 69, oy + 52, 22, 12, INK);
  vline(ox + 136, oy + 52, oy + 78, INK);
  fillRect(ox + 136, oy + 52, 12, 7, RED);
  fillRect(ox + 36, oy + 24, 16, 8, INK);
  fillCircle(ox + 32, oy + 24, 5, INK);
  fillCircle(ox + 56, oy + 24, 5, INK);
  dashLine(ox + 44, oy + 34, ox + 66, oy + 56, 5, INK);
}

// 3: tanker that hit a mine in the Strait of Hormuz, on fire
function drawTanker(ox: number, oy: number): void {
  zigzag(ox + 4, ox + 172, oy + 104, 4, 12, BLUE);
  zigzag(ox + 4, ox + 172, oy + 116, 4, 12, BLUE);
  for (let y = 82; y <= 104; y++) {
    const t = (y - 82) / 22;
    hline(ox + Math.floor(16 + 10 * t), ox + Math.ceil(160 - 10 * t), oy + y, INK);
  }
  fillRect(ox + 128, oy + 64, 20, 18, INK);
  fillRect(ox + 132, oy + 68, 12, 5, PAPER);
  fillRect(ox + 96, oy + 70, 10, 12, RED);
  const flame = (x0: number, w: number, h: number): void => {
    for (let dy = 0; dy <= h; dy++) {
      const y = oy + 82 - h + dy;
      const hw = Math.floor((w / 2) * (dy / h));
      hline(ox + x0 + w / 2 - hw, ox + x0 + w / 2 + hw, y, RED);
    }
  };
  flame(30, 22, 34);
  flame(54, 26, 44);
  flame(82, 20, 30);
  ring(ox + 60, oy + 26, 6, INK);
  ring(ox + 74, oy + 18, 5, INK);
  ring(ox + 86, oy + 28, 4, INK);
  fillCircle(ox + 148, oy + 112, 4, INK);
  for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const r = a * Math.PI / 180;
    line(ox + 148 + Math.round(5 * Math.cos(r)), oy + 112 + Math.round(5 * Math.sin(r)),
      ox + 148 + Math.round(9 * Math.cos(r)), oy + 112 + Math.round(9 * Math.sin(r)), INK);
  }
}

// 4: satellite with a warhead over the Earth
function drawSatellite(ox: number, oy: number): void {
  fillCircle(ox + 88, oy + 84, 36, INK);
  fillRect(ox + 70, oy + 66, 14, 8, PAPER);
  fillRect(ox + 96, oy + 86, 16, 8, PAPER);
  const cx = ox + 88, cy = oy + 84;
  for (let deg = 160; deg >= 20; deg -= 2) {
    if (Math.floor((160 - deg) / 10) % 2 !== 0) continue;
    const r = deg * Math.PI / 180;
    setPixel(cx + Math.round(52 * Math.cos(r)), cy - Math.round(52 * Math.sin(r)), INK);
    setPixel(cx + Math.round(54 * Math.cos(r)), cy - Math.round(54 * Math.sin(r)), INK);
  }
  fillRect(ox + 76, oy + 14, 24, 18, INK);
  fillRect(ox + 44, oy + 18, 28, 10, INK);
  fillRect(ox + 104, oy + 18, 28, 10, INK);
  for (const gx of [52, 60, 68, 112, 120, 128]) vline(ox + gx, oy + 18, oy + 28, PAPER);
  fillRect(ox + 86, oy + 40, 4, 4, RED);
  fillRect(ox + 85, oy + 41, 6, 2, RED);
  fillRect(ox + 85, oy + 45, 6, 2, RED);
  hline(ox + 22, ox + 30, oy + 44, INK);
  vline(ox + 26, oy + 40, oy + 48, INK);
  hline(ox + 148, ox + 154, oy + 32, INK);
  vline(ox + 151, oy + 29, oy + 35, INK);
}

// 5: the ICJ courthouse
function drawCourt(ox: number, oy: number): void {
  for (let y = 14; y <= 48; y++) {
    const t = (y - 14) / 34;
    hline(ox + Math.floor(88 - 60 * t), ox + Math.ceil(88 + 60 * t), oy + y, INK);
  }
  fillRect(ox + 24, oy + 48, 128, 8, INK);
  for (const x of [34, 66, 98, 130]) fillRect(ox + x, oy + 56, 14, 62, INK);
  fillRect(ox + 20, oy + 118, 136, 4, INK);
  fillRect(ox + 12, oy + 122, 152, 4, INK);
  ring(ox + 88, oy + 32, 7, PAPER);
  fillCircle(ox + 88, oy + 32, 2, PAPER);
}

// ---------- compose ----------
const STORIES: [string, string][] = [
  ['HUAWEI GUILTY OF TRADE-SECRET FRAUD', 'US JURY: THEFT AND BANK FRAUD, ACQUITTED OF RACKETEERING'],
  ['UKRAINE HITS SPARTA II OFF FINLAND', 'DRONES STRIKE RUSSIAN CARGO SHIP - KYIV CONFIRMS'],
  ['FOUR TANKERS HIT MINES IN HORMUZ', 'IRGC: FOUR VESSELS BLEW UP AND CAUGHT FIRE'],
  ['RUSSIA PLANS NUCLEAR WEAPON IN SPACE', 'NATO CHIEF RUTTE: WE WILL DEFEND SPACE'],
  ['ICJ: MYANMAR COMMITTED GENOCIDE', 'COURT FINDS MYANMAR GENOCIDE OF ROHINGYA'],
];
const PICTOS = [drawScales, drawShip, drawTanker, drawSatellite, drawCourt];

function draw(): void {
  drawMasthead();
  for (let i = 0; i < 5; i++) {
    const py = 168 + i * 164;
    drawPanelFrame(i, py);
    PICTOS[i](40, py + 12);
    drawCaptions(py, STORIES[i][0], STORIES[i][1]);
  }
  fillRect(20, 988, 983, 3, INK);
  drawTextCentered(998, 'ONE DAY OF WORLD NEWS IN ONE IMAGE', 1, INK);
}

// ---------- run: write entry.png, delete nothing ----------
function main(): void {
  draw();
  const dir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'entry.png'), encodePNG());
}

main();
