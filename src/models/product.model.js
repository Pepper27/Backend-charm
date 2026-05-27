const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);
const { Types } = require("mongoose");
const variantSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  material: String,
  color: String,
  size: String,
  price: Number,
  quantity: { type: Number, default: 0 },
  sold: { type: Number, default: 0 },
  images: [String],
});

const schema = new mongoose.Schema(
  {
    name: String,
    description: String,
    options: {
      materials: [String],
      colors: [String],
      sizes: [String],
    },
    // Faceted attributes as references for efficient filtering
    // materials: [{ type: Types.ObjectId, ref: "Material" }],
    // colors: [{ type: Types.ObjectId, ref: "Color" }],
    // sizes: [{ type: Types.ObjectId, ref: "Size" }],
    // themes: [{ type: Types.ObjectId, ref: "Theme" }],
    // Precomputed price range for product (min/max across variants)
    priceMin: { type: Number, default: 0 },
    priceMax: { type: Number, default: 0 },
    category: { type: Types.ObjectId, ref: "Category" },
    // Pandora-style: a product can belong to multiple collections.
    collections: [{ type: Types.ObjectId, ref: "Collection" }],
    variants: [variantSchema],
    // Engraving configuration for PDP and engraving UI
    engraving: {
      enabled: { type: Boolean, default: false },
      previewImage: { type: String, default: "" },
      // box coordinates as percentages on preview image
      box: {
        xPct: Number,
        yPct: Number,
        wPct: Number,
        hPct: Number,
        rotateDeg: { type: Number, default: 0 },
      },
      // multiple engraving areas (relative percentages on preview image)
      // Example: { id: 'front', xPct: 10, yPct: 20, wPct: 50, hPct: 30, shape: 'rect' }
      areas: [
        {
          id: String,
          xPct: Number,
          yPct: Number,
          wPct: Number,
          hPct: Number,
          // shape could be 'rect' or 'circle' etc. Keep flexible as string.
          shape: { type: String, default: "rect" },
        },
      ],
      fonts: [String],
    },
    createdBy: { type: Types.ObjectId, ref: "AccountAdmin" },
    updatedBy: { type: Types.ObjectId, ref: "AccountAdmin" },
    slug: {
      type: String,
      slug: "name",
      unique: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: { type: Types.ObjectId, ref: "AccountAdmin" },
    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);

const Product = mongoose.model("Product", schema, "product");
module.exports = Product;

// indexes for facets and price
schema.index({ category: 1 });
schema.index({ materials: 1 });
schema.index({ colors: 1 });
schema.index({ sizes: 1 });
schema.index({ themes: 1 });
schema.index({ priceMin: 1, priceMax: 1 });

// Ensure priceMin/priceMax are computed from variants on save/update
schema.pre("save", function (next) {
  try {
    const variants = Array.isArray(this.variants) ? this.variants : [];
    const prices = variants
      .map((v) => Number(v && v.price ? v.price : 0))
      .filter((n) => Number.isFinite(n));
    if (prices.length) {
      this.priceMin = Math.min(...prices);
      this.priceMax = Math.max(...prices);
    } else {
      this.priceMin = 0;
      this.priceMax = 0;
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

// Auto-generate engraving.areas from previewImage when engraving.enabled === true
// Use an async hook via pre('save') callback style that supports async work.
schema.pre("save", async function (next) {
  try {
    const gen = require("../lib/engraving-area-detector");
    if (this.engraving && this.engraving.enabled) {
      const hasAreas = Array.isArray(this.engraving.areas) && this.engraving.areas.length > 0;
      if (!hasAreas && this.engraving.previewImage) {
        try {
          const areas = await gen.generateAreasFromPreview(this.engraving.previewImage);
          if (areas && areas.length) {
            this.engraving.areas = areas;
          }
        } catch (e) {
          // non-fatal: log and continue
          console.warn("engraving area detect failed for product", this._id, e?.message || e);
        }
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

// Also handle findOneAndUpdate / updateOne operations where variants may change
schema.pre(["findOneAndUpdate", "updateOne", "updateMany"], async function (next) {
  try {
    // If variants are being updated explicitly, compute new priceMin/priceMax
    const update = this.getUpdate && this.getUpdate();
    if (!update) return next();

    // Support both $set and direct updates
    const variants = (update.$set && update.$set.variants) || update.variants;
    if (!variants) return next();

    const prices = Array.isArray(variants)
      ? variants.map((v) => Number(v && v.price ? v.price : 0)).filter((n) => Number.isFinite(n))
      : [];
    const priceMin = prices.length ? Math.min(...prices) : 0;
    const priceMax = prices.length ? Math.max(...prices) : 0;

    // Apply the computed fields to the update
    if (!update.$set) update.$set = {};
    update.$set.priceMin = priceMin;
    update.$set.priceMax = priceMax;

    this.setUpdate(update);
    return next();
  } catch (err) {
    return next(err);
  }
});
