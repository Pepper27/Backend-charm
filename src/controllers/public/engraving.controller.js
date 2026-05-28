const axios = require('axios');
const sharp = require('sharp');
const cloudinaryHelper = require('../../helper/cloudinary.helper');
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');

const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1600;
const MAX_TEXT_LENGTH = 2000;

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fetchImageBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: 10 * 1024 * 1024 });
  return Buffer.from(res.data);
}

function findFontFile(fontId) {
  if (!fontId) return null;
  const fontsDir = path.resolve(__dirname, '../../assets/fonts');
  const candidates = [
    `${fontId}.ttf`,
    `${fontId}.otf`,
    `${fontId}.woff`,
    `${fontId}.woff2`,
  ];
  for (const f of candidates) {
    const p = path.join(fontsDir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function buildFontFaceCss(fontId, familyName) {
  try {
    const fontPath = findFontFile(fontId);
    if (!fontPath) return null;
    const data = fs.readFileSync(fontPath);
    const ext = path.extname(fontPath).toLowerCase().replace('.', '');
    const mime = ext === 'ttf' || ext === 'otf' ? 'font/ttf' : `font/${ext}`;
    const b64 = data.toString('base64');
    return `@font-face{font-family:'${familyName}';src:url('data:${mime};base64,${b64}') format('${ext}');font-weight:400;font-style:normal;}`;
  } catch (e) {
    console.warn('buildFontFaceCss failed', e && e.message);
    return null;
  }
}

function buildSvgOverlay({ width, height, lines, fontFamily = 'sans-serif', fontSize = 32, color = '#000', boxCx, boxCy, boxW, boxH, rotateDeg = 0, fontId = undefined }) {
  // lines: array of strings (already trimmed)
  const lineHeight = 1.15;

  // choose a stable family name when embedding
  const embeddedFamily = fontId ? `engrave-${fontId}` : null;
  const familyToUse = embeddedFamily || fontFamily || 'sans-serif';

  // try to build @font-face css if font file present
  const fontFaceCss = fontId ? buildFontFaceCss(fontId, embeddedFamily) : null;

  // compute explicit y for each line to avoid renderer baseline differences
  const totalH = lines.length * fontSize * lineHeight;
  const startY = -Math.round(totalH / 2) + Math.round(fontSize / 2);
  const tspans = lines
    .map((ln, i) => {
      const y = Math.round(startY + i * fontSize * lineHeight);
      return `<tspan x="0" y="${y}">${esc(ln)}</tspan>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs>` +
    `<style><![CDATA[${fontFaceCss ? fontFaceCss : ''} .engrave { font-family: ${familyToUse}; font-size: ${fontSize}px; fill: ${color}; font-weight: 400; }]]></style>` +
    `</defs>` +
    `<rect width="100%" height="100%" fill="transparent" />` +
    `<g transform="translate(${boxCx}, ${boxCy}) rotate(${rotateDeg})">` +
    `<text class="engrave" text-anchor="middle">${tspans}</text>` +
    `</g>` +
    `</svg>`;

  return Buffer.from(svg);
}

exports.render = async function render(req, res) {
  try {
    const body = req.body || {};
    const {
      productImageUrl,
      width = 800,
      height = 800,
      text = '',
      fontFamily,
      fontSizePx, // use client's computed pixel size when available
      color = '#0b1220',
      box = {}, // expects percentages: xPct,yPct,wPct,hPct,rotateDeg
    } = body;

    if (!productImageUrl) return res.status(400).json({ message: 'productImageUrl is required' });
    if (String(text).length > MAX_TEXT_LENGTH) return res.status(400).json({ message: 'text too long' });

    const outW = Math.min(Number(width) || 800, MAX_WIDTH);
    const outH = Math.min(Number(height) || 800, MAX_HEIGHT);

    // fetch base image
    const baseBuf = await fetchImageBuffer(productImageUrl);

    // determine original image size via sharp metadata
    const meta = await sharp(baseBuf).metadata();
    const iw = meta.width || outW;
    const ih = meta.height || outH;

    // compute how the frontend draws image with object-fit: contain and centered
    const srcRatio = iw / ih;
    const dstRatio = outW / outH;
    let dw = outW;
    let dh = outH;
    if (srcRatio > dstRatio) {
      // fit width
      dw = outW;
      dh = Math.round(outW / srcRatio);
    } else {
      // fit height
      dh = outH;
      dw = Math.round(outH * srcRatio);
    }
    const dx = Math.round((outW - dw) / 2);
    const dy = Math.round((outH - dh) / 2);

    // resize base to fit inside canvas with contain and white background like frontend fill
    const base = await sharp(baseBuf)
      .resize(outW, outH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .toBuffer();

    // compute box in canvas coords using box percentages (frontend uses boxSafe)
    const xPct = Number(box.xPct || 50) / 100;
    const yPct = Number(box.yPct || 50) / 100;
    const wPct = Number(box.wPct || 50) / 100;
    const hPct = Number(box.hPct || 18) / 100;
    const rotateDeg = Number(box.rotateDeg || 0);

    const boxCx = dx + xPct * dw;
    const boxCy = dy + yPct * dh;
    const boxW = wPct * dw;
    const boxH = hPct * dh;

    // prepare text lines similar to frontend (limit 3 lines)
    const rawLines = String(text || '').split('\n').slice(0, 3).map((l) => (l || '').trim()).filter(Boolean);
    const lines = rawLines.length ? rawLines : [''];

    const fontSize = Math.max(6, Math.floor(Number(fontSizePx) || Math.floor(boxH / (lines.length * 1.15))));

    const svgBuffer = buildSvgOverlay({ width: outW, height: outH, lines, fontFamily: fontFamily || 'Arial, Helvetica, sans-serif', fontSize, color, boxCx, boxCy, boxW, boxH, rotateDeg });

    // composite SVG over base
    const compositeBuf = await sharp(base).composite([{ input: svgBuffer }]).webp({ quality: 80 }).toBuffer();

    // upload to cloudinary
    const dataUrl = `data:image/webp;base64,${compositeBuf.toString('base64')}`;
    const uploadRes = await cloudinaryHelper.cloudinary.uploader.upload(dataUrl, { folder: 'engraving' });

    return res.json({ url: uploadRes.secure_url, width: outW, height: outH });
  } catch (err) {
    console.error('engraving.render error', err && err.message, err && err.stack);
    return res.status(500).json({ message: 'render failed', error: err && err.message });
  }
};

// Upload a client-generated data URL (thumbnail) to Cloudinary.
// Expects JSON body: { dataUrl: 'data:image/png;base64,...' }
exports.uploadDataUrl = async function uploadDataUrl(req, res) {
  try {
    const body = req.body || {};
    const { dataUrl } = body;
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ message: 'dataUrl (data:image/...) is required' });
    }

    // parse mime and base64
    const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.*)$/i);
    if (!m) return res.status(400).json({ message: 'invalid dataUrl format' });
    const mime = m[1].toLowerCase();
    const b64 = m[3];

    // decode size limit (decoded bytes)
    const MAX_DECODE_BYTES = 3 * 1024 * 1024; // 3MB
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > MAX_DECODE_BYTES) return res.status(413).json({ message: 'image too large' });

    // Re-encode / sanitize image via sharp (limit dimensions)
    let img = sharp(buf).rotate();
    const meta = await img.metadata().catch(() => ({}));
    const maxDim = 1600;
    if ((meta.width && meta.width > maxDim) || (meta.height && meta.height > maxDim)) {
      img = img.resize({ width: maxDim, height: maxDim, fit: 'inside' });
    }
    const outBuf = await img.webp({ quality: 80 }).toBuffer();

    const dataUri = `data:image/webp;base64,${outBuf.toString('base64')}`;
    const uploadRes = await cloudinaryHelper.cloudinary.uploader.upload(dataUri, { folder: 'engraving' });

    return res.json({ url: uploadRes.secure_url, width: meta.width || null, height: meta.height || null });
  } catch (err) {
    console.error('engraving.uploadDataUrl error', err && err.message, err && err.stack);
    return res.status(500).json({ message: 'upload failed', error: err && err.message });
  }
};
