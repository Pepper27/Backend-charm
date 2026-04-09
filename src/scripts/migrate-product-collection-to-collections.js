/*
One-time migration:
  Product.collection (ObjectId) -> Product.collections (ObjectId[])

Run:
  node src/scripts/migrate-product-collection-to-collections.js

Notes:
  - Uses the same DB connection as the app (config/database.js)
  - Safe to run multiple times (idempotent)
*/

require("dotenv").config();

const mongoose = require("mongoose");
const { connectDB } = require("../config/database.js");
const Product = require("../models/product.model");

const asObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const str = String(value);
  if (!mongoose.Types.ObjectId.isValid(str)) return null;
  return new mongoose.Types.ObjectId(str);
};

const run = async () => {
  await connectDB();

  const cursor = Product.find({
    collection: { $exists: true, $ne: null },
  })
    .select("_id collection collections")
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const one = asObjectId(doc.collection);
    if (!one) {
      skipped += 1;
      continue;
    }

    const existing = Array.isArray(doc.collections)
      ? doc.collections
          .map(asObjectId)
          .filter(Boolean)
          .map((id) => id.toString())
      : [];

    if (existing.includes(one.toString())) {
      skipped += 1;
      continue;
    }

    await Product.updateOne(
      { _id: doc._id },
      {
        $addToSet: { collections: one },
      }
    );
    updated += 1;
  }

  console.log(JSON.stringify({ scanned, updated, skipped }, null, 2));

  // Optional cleanup: keep the old field for backward-compatibility until you're confident.
  // If you want to unset it later, run a separate cleanup script.
  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("Migration failed", err);
  try {
    await mongoose.connection.close();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
