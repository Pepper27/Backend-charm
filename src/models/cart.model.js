const mongoose = require("mongoose");

// Keep existing `products[]` for legacy checkout flow,
// and add `bundles[]` for mix-charm guest/user cart items.

const bundleItemSchema = new mongoose.Schema(
  {
    slotIndex: Number,
    charmProductId: String,
    charmVariantCode: String,
    // Client-side drag offset, normalized by canvas size.
    // Optional so legacy payloads continue to work.
    offsetN: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

const bundleSchema = new mongoose.Schema(
  {
    bundleId: String,
    // Optional display name for admin/customer listing.
    name: { type: String, default: "" },
    bracelet: {
      productId: String,
      variantCode: String,
      sizeCm: Number,
      typeCode: String,
    },
    items: [bundleItemSchema],
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
    quantity: { type: Number, default: 1 },
    // Bundle-level timestamp (cart.updatedAt is not precise per bundle).
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    // Public controllers store userId as stringified ObjectId for simplicity.
    // Keeping it as String avoids migration/compat issues with existing data.
    userId: { type: String, default: "" },
    guestId: { type: String, default: "" },

    // Legacy cart items (used by client/order flow)
    products: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        variantId: String,
        quantity: Number,
        price: Number,
      },
    ],

    // Mix-charm bundle items
    bundles: [bundleSchema],
  },
  { timestamps: true }
);

const Cart = mongoose.model("Cart", schema, "carts");
module.exports = Cart;
