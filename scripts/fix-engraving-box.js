/*
  Migration script: fix engraving.box for products where box is stored as a non-object (string/null)
  Usage: from Backend-charm root run `node scripts/fix-engraving-box.js`
*/
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');

const defaultBox = { xPct:25, yPct:42, wPct:50, hPct:18, rotateDeg:0 };

async function main() {
  const uri = process.env.DATABASE;
  if (!uri) {
    console.error('Missing DATABASE env');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to DB');

  // Find products where engraving.box is string type (2) or engraving.box is null/missing
  const byType = await Product.find({ 'engraving.box': { $type: 2 } }).select('_id engraving.box').lean();
  console.log('Products with engraving.box as string:', byType.length);
  for (const p of byType) {
    console.log('Fixing (string) product', p._id, 'value:', p.engraving && p.engraving.box);
    await Product.updateOne({ _id: p._id }, { $set: { 'engraving.box': defaultBox } });
  }

  const byNull = await Product.find({ 'engraving': { $exists: true }, $or: [ { 'engraving.box': null }, { 'engraving.box': { $exists: false } } ] }).select('_id engraving.box').lean();
  console.log('Products with engraving.box null/missing:', byNull.length);
  for (const p of byNull) {
    console.log('Fixing (null/missing) product', p._id);
    await Product.updateOne({ _id: p._id }, { $set: { 'engraving.box': defaultBox } });
  }

  console.log('Done');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
