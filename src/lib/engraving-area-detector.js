const axios = require("axios");
const sharp = require("sharp");

// Download image and compute a foreground bounding box in percentage units.
// Returns an array of areas or [] if nothing detected.
async function generateAreasFromPreview(url, opts = {}) {
  const timeout = opts.timeout || 15000;
  if (!url) return [];

  const resp = await axios.get(url, { responseType: "arraybuffer", timeout });
  const buf = Buffer.from(resp.data);

  // Resize for performance while preserving aspect ratio
  const resized = sharp(buf).resize({ width: 800, withoutEnlargement: true }).ensureAlpha();
  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const pixels = data; // Buffer

  const hasAlpha = channels >= 4;

  // sample corner pixels to estimate background color
  function getPixel(i, j) {
    const idx = (j * width + i) * channels;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    const a = channels >= 4 ? pixels[idx + 3] : 255;
    return [r, g, b, a];
  }

  const corners = [
    getPixel(0, 0),
    getPixel(width - 1, 0),
    getPixel(0, height - 1),
    getPixel(width - 1, height - 1),
  ];
  // pick median corner as bg
  const bg = corners[Math.floor(corners.length / 2)];
  const [bgR, bgG, bgB, bgA] = bg;

  const mask = new Uint8Array(width * height);
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0,
    area = 0;

  const colorThreshold = opts.colorThreshold || 30; // pixel distance
  const alphaThreshold = opts.alphaThreshold || 250; // treat < 250 as transparent

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = channels >= 4 ? pixels[idx + 3] : 255;

      let fg = false;
      if (hasAlpha && a < alphaThreshold) fg = true;
      else {
        const dr = r - bgR;
        const dg = g - bgG;
        const db = b - bgB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist > colorThreshold) fg = true;
      }

      if (fg) {
        mask[y * width + x] = 1;
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (area === 0 || maxX <= minX || maxY <= minY) return [];

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;

  const xPct = (minX / width) * 100;
  const yPct = (minY / height) * 100;
  const wPct = (boxW / width) * 100;
  const hPct = (boxH / height) * 100;

  const rectArea = boxW * boxH;
  const fillRatio = area / rectArea;
  const aspect = boxW / boxH;
  const isCircle = Math.abs(aspect - 1) < 0.3 && fillRatio > 0.5;

  return [
    {
      id: "auto",
      xPct: Number(xPct.toFixed(2)),
      yPct: Number(yPct.toFixed(2)),
      wPct: Number(wPct.toFixed(2)),
      hPct: Number(hPct.toFixed(2)),
      shape: isCircle ? "circle" : "rect",
    },
  ];
}

module.exports = { generateAreasFromPreview };
