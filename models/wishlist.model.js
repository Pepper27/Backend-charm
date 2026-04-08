const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "AccountClient", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    // Optional: save a specific variant (code) if FE supports it.
    variantCode: { type: String, default: "" },
  },
  { timestamps: true }
);

schema.index({ userId: 1, productId: 1, variantCode: 1 }, { unique: true });

const Wishlist = mongoose.model("Wishlist", schema, "wishlists");
module.exports = Wishlist;
