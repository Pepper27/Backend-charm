// Run this script with node to populate priceMin/priceMax for existing products
// Example: node src/scripts/populate-price-min-max.js

const mongoose = require('mongoose');
const Product = require('../models/product.model');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/charm';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to', uri);

  const cursor = Product.find({}).cursor();
  let count = 0;
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const variants = Array.isArray(doc.variants) ? doc.variants : [];
    const prices = variants.map(v => Number(v && v.price ? v.price : 0)).filter(n => Number.isFinite(n));
    const priceMin = prices.length ? Math.min(...prices) : 0;
    const priceMax = prices.length ? Math.max(...prices) : 0;
    if (doc.priceMin !== priceMin || doc.priceMax !== priceMax) {
      doc.priceMin = priceMin;
      doc.priceMax = priceMax;
      await doc.save();
      count++;
    }
  }

  console.log('Updated products:', count);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
