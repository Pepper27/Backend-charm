const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountClient",
      index: true,
      default: null,
    },
    guestId: {
      type: String,
      index: true,
      default: null,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    variantCode: { type: String, default: "" },
    viewedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Prevent duplicates per owner (user or guest)
schema.index(
  { userId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } }
);
schema.index(
  { guestId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { guestId: { $type: "string" } } }
);

// Auto-expire after 30 days
schema.index({ viewedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const RecentlyViewed = mongoose.model("RecentlyViewed", schema, "recently_viewed");
module.exports = RecentlyViewed;
