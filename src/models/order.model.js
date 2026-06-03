const mongoose = require("mongoose");
const { Types } = require("mongoose");
slug = require('mongoose-slug-updater')
mongoose.plugin(slug)
// Snapshot schemas for mix-charm bundle orders (bracelet + multiple charms).
const orderBundleItemSchema = new mongoose.Schema(
  {
    slotIndex: Number,
    charmProductId: String,
    charmVariantCode: String,
    offsetN: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

const orderBundleSchema = new mongoose.Schema(
  {
    bundleId: String,
    name: { type: String, default: "" },
    bracelet: {
      productId: String,
      variantCode: String,
      sizeCm: Number,
      typeCode: String,
    },
    items: [orderBundleItemSchema],
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
  },
  { _id: false }
);
const orderItemSchema = new mongoose.Schema({
  productId: {
    type: Types.ObjectId,
    ref: "Product",
  },
  variantId: String,
  name: String,
  // Variant snapshot at checkout time (for order history UI)
  material: { type: String, default: "" },
  color: { type: String, default: "" },
  size: { type: String, default: "" },
  price: Number,
  quantity: Number,
  image: String,
  // Engraving snapshot if this line had engraving
  engraving: {
    text: { type: String, default: "" },
    fontId: { type: String, default: "" },
    fontSizePx: Number,
    // persist preview image so admin UI can show proof of engraving
    previewImage: { type: String, default: "" },
  },
  // Whether this line has been restocked after a cancel to avoid double-restock.
  stockReleased: { type: Boolean, default: false },
});
const schema = new mongoose.Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "AccountClient",
    },
    // For guest checkout and cross-device lookup.
    guestId: { type: String, default: "" },
    orderCode: String,

    // Contact snapshot at checkout time.
    fullName: { type: String, default: "" },
    slug:{
      type: String, 
      slug: "fullName",
      unique:true
    },
    email: { type: String, default: "" },
    phone: String,
    address: String,

    // Flattened components for admin totals and sold counters.
    cart: [orderItemSchema],

    // Bundle snapshots so admin can assemble the design.
    bundles: [orderBundleSchema],
    totalPrice: Number,
    status: {
      type: String,
      enum: ["pending", "confirmed", "shipping", "delivered", "cancelled"],
      default: "pending",
    },
    method: {
      type: String,
      enum: ["cash", "zalopay"],
      default: "cash",
    },
    payStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
    },
    // Cancellation metadata
    cancelledAt: Date,
    cancelledBy: { type: String, enum: ["customer", "admin", "system", ""], default: "" },
    cancelReason: { type: String, default: "" },
    // Status history for audit and UI timeline
    statusHistory: [
      {
        status: String,
        changedAt: Date,
        changedBy: String,
        note: String,
      },
    ],
    // Payment related details (refundStatus and refund history kept here)
    payment: {
      capturedAmount: { type: Number, default: 0 },
      providerChargeId: { type: String, default: "" },
      // ZaloPay order query identifiers
      appTransId: { type: String, default: "" },
      zpTransId: { type: String, default: "" },
      refundStatus: {
        type: String,
        enum: ["none", "pending", "processing", "succeeded", "failed", "manual_review"],
        default: "none",
      },
      refunds: [
        {
          amount: Number,
          createdAt: Date,
          status: String,
          providerResponse: mongoose.Schema.Types.Mixed,
        },
      ],
    },
    updatedBy: String,
    deletedBy: String,
    deletedAt: Date,
    checkStatus: {
      type: Boolean,
      default: false,
    },
    deleted: {
      type: Boolean,
      default: false,
    }, // Xóa dấu ngoặc nhọn dư thừa ở đây

    // Snapshot of cart selections at checkout time.
    // Required for payment flows where cart is cleared only after payment confirmation.
    checkoutSnapshot: {
      bundleIds: [String],
      productLineIds: [String],
      buyNowVariantIds: [String],
    },
  }, // Đây mới là dấu đóng của Schema
  {
    timestamps: true,
  }
);

const Order = mongoose.model("Order", schema, "orders");
module.exports = Order;
