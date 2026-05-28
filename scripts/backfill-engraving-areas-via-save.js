/**
 * Backfill script: load products with engraving.enabled true but no areas,
 * and call save() so pre-save hook will generate areas via detector.
 * Usage: MONGO_URI="..." node scripts/backfill-engraving-areas-via-save.js
 */
const mongoose = require("mongoose");
const Product = require("../src/models/product.model");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/charm";

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to", MONGO_URI);

  const cursor = Product.find({
    engraving: { $exists: true },
    "engraving.enabled": true,
    $or: [{ "engraving.areas": { $exists: false } }, { "engraving.areas": { $size: 0 } }],
  }).cursor();

  let count = 0;
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    try {
      console.log("Processing", doc._id.toString());
      await doc.save();
      console.log("Saved", doc._id.toString());
      count++;
    } catch (e) {
      console.error("Failed", doc._id.toString(), e.message || e);
    }
  }

  console.log("Done. Updated", count, "products.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
