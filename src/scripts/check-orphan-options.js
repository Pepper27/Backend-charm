// Script to find option values present in products but missing from admin lists
// Run: node src/scripts/check-orphan-options.js

const mongoose = require('mongoose');
const Product = require('../models/product.model');
const Size = require('../models/size.model');
const Color = require('../models/color.model');
const Material = require('../models/material.model');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/charm';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to', uri);

  const sizes = new Set();
  const colors = new Set();
  const materials = new Set();

  const cursor = Product.find({}).cursor();
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const opts = doc.options || {};
    (opts.sizes || []).forEach(s => sizes.add(String(s)));
    (opts.colors || []).forEach(c => colors.add(String(c)));
    (opts.materials || []).forEach(m => materials.add(String(m)));
    (doc.variants || []).forEach(v => {
      if (v.size) sizes.add(String(v.size));
      if (v.color) colors.add(String(v.color));
      if (v.material) materials.add(String(v.material));
    });
  }

  const [sizeDocs, colorDocs, materialDocs] = await Promise.all([
    Size.find({ deleted: false }).lean(),
    Color.find({ deleted: false }).lean(),
    Material.find({ deleted: false }).lean(),
  ]);

  const sizeNames = new Set(sizeDocs.map(d => String(d.name)));
  const colorNames = new Set(colorDocs.map(d => String(d.name)));
  const materialNames = new Set(materialDocs.map(d => String(d.name)));

  const orphanSizes = [...sizes].filter(s => !sizeNames.has(s));
  const orphanColors = [...colors].filter(c => !colorNames.has(c));
  const orphanMaterials = [...materials].filter(m => !materialNames.has(m));

  console.log('Orphan sizes:', orphanSizes.length, orphanSizes.slice(0, 50));
  console.log('Orphan colors:', orphanColors.length, orphanColors.slice(0, 50));
  console.log('Orphan materials:', orphanMaterials.length, orphanMaterials.slice(0, 50));

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
