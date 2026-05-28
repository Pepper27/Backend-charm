const engraving = require('../src/controllers/public/engraving.controller');
const fs = require('fs');

async function run() {
  // mock req/res
  const req = { body: {
    productImageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1200',
    width: 600,
    height: 600,
    text: 'hi hi hi hi',
    fontSizePx: 64,
    box: { xPct: 50, yPct: 50, wPct: 60, hPct: 25, rotateDeg: 0 }
  } };

  const res = {
    json: (obj) => {
      console.log('resp json', obj);
    },
    status: (s) => ({ json: (obj) => console.log('status', s, obj) })
  };

  // monkeypatch cloudinary upload to write file
  const helper = require('../src/helper/cloudinary.helper');
  const origUpload = helper.cloudinary.uploader.upload;
  helper.cloudinary.uploader.upload = async (dataUrl, opts) => {
    // dataUrl is data:image/webp;base64,...
    const base = dataUrl.split(',')[1];
    const buf = Buffer.from(base, 'base64');
    fs.writeFileSync('/tmp/test-engraving.webp', buf);
    return { secure_url: 'file:///tmp/test-engraving.webp' };
  };

  await engraving.render(req, res);

  // restore
  helper.cloudinary.uploader.upload = origUpload;
}

run().catch(e => console.error(e));
