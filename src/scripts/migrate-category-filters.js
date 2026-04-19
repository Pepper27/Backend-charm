/**
 * Migration script: populate visibleFilters and filterOptions for known categories
 * Usage: NODE_ENV=development node src/scripts/migrate-category-filters.js
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const Category = require('../models/category.model');

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/charm';
  // Modern mongoose accepts just the uri; options like useNewUrlParser/useUnifiedTopology are no longer required
  await mongoose.connect(mongoUri);

  const updates = [
    {
      slug: 'charm',
      visibleFilters: ['material','collection','price','theme','classification'],
      filterOptions: {
        material: ['Mạ vàng 14k','Bạc','Twotone'],
        collection: ['Spring 2026','Love Collection','Nature'],
        price: ['Dưới 1.000.000đ','1.000.001đ - 2.500.000đ','2.500.001đ - 5.000.000đ','Trên 7.000.001đ'],
        theme: ['Biểu tượng','Gia đình và bạn bè','Thiên nhiên và vũ trụ','Tình yêu'],
        classification: ['Vintage','Statement','Minimal']
      }
    }
  ];

  for (const u of updates) {
    const res = await Category.findOneAndUpdate(
      { slug: u.slug },
      { $set: { visibleFilters: u.visibleFilters, filterOptions: u.filterOptions } },
      { new: true }
    );
    console.log(`Updated slug=${u.slug} -> ${res ? 'OK' : 'NOT FOUND'}`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
