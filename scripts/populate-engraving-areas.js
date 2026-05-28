/**
 * Migration script: populate engraving.areas for products that don't have it.
 * Usage: from repo root run `node scripts/populate-engraving-areas.js [--apply]`
 * Without --apply the script runs in dry-run and prints changes it would make.
 */
const mongoose = require("mongoose");
const Product = require("../src/models/product.model");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/charm";

async function main() {
  await mongoose.connect(MONGO_URI);
  const apply = process.argv.includes("--apply");

  // Find products that have engraving object but no areas array or empty areas
  const docs = await Product.find({
    engraving: { $exists: true },
    $or: [{ "engraving.areas": { $exists: false } }, { "engraving.areas": { $size: 0 } }],
  })
    .select("_id engraving")
    .lean();

  console.log(`Found ${docs.length} products to inspect`);

  for (const p of docs) {
    const e = p.engraving || {};
    let areas = [];

    if (
      e.box &&
      typeof e.box === "object" &&
      (e.box.wPct || e.box.hPct || e.box.xPct || e.box.yPct)
    ) {
      // use existing box as single area
      areas.push({
        id: "default",
        xPct: Number(e.box.xPct || 0),
        yPct: Number(e.box.yPct || 0),
        wPct: Number(e.box.wPct || 100),
        hPct: Number(e.box.hPct || 100),
        shape: "rect",
      });
    } else {
      // fallback: centered default area (50% width, 30% height)
      areas.push({ id: "default", xPct: 25, yPct: 35, wPct: 50, hPct: 30, shape: "rect" });
    }

    console.log(`Product ${p._id} -> will set areas:`, areas);
    if (apply) {
      const meta = { detected: true, at: new Date() };
      await Product.updateOne(
        { _id: p._id },
        { $set: { "engraving.areas": areas, "engraving._autoDetected": meta } }
      );
      console.log(`Updated ${p._id}`);
    }
  }

  await mongoose.disconnect();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
