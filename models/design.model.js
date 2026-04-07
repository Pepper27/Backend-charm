const mongoose = require("mongoose");

const designItemSchema = new mongoose.Schema(
  {
    slotIndex: Number,
    charmProductId: String,
    charmVariantCode: String,
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    guestId: { type: String, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "AccountClient", default: null, index: true },
    name: { type: String, default: "" },

    // Snapshot of mix payload (stable even if product data changes).
    bracelet: {
      productId: String,
      variantCode: String,
      sizeCm: Number,
      typeCode: String,
    },
    items: [designItemSchema],

    rulesSnapshot: {
      slotCount: Number,
      recommendedCharms: Number,
      clipZonePercents: [Number],
    },
    priceSnapshot: {
      braceletPrice: Number,
      charmsPrice: Number,
      total: Number,
    },

    // Convenience: if we created a cart bundle at save time.
    createdBundleId: { type: String, default: "" },
  },
  { timestamps: true }
);

schema.index({ guestId: 1, createdAt: -1 });
schema.index({ userId: 1, createdAt: -1 });

const Design = mongoose.model("Design", schema, "designs");
module.exports = Design;
