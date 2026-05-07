const mongoose = require("mongoose");
const { Types } = require("mongoose");

const schema = new mongoose.Schema(
  {
    orderId: { type: Types.ObjectId, ref: "Order", required: true },
    orderCode: { type: String, required: true },
    // Payment provider to call, e.g. "zalopay"
    provider: { type: String, required: true },
    // payload needed by provider adapter (provider-specific)
    payload: mongoose.Schema.Types.Mixed,
    // job status and attempts
    status: {
      type: String,
      enum: ["pending", "processing", "succeeded", "failed", "manual_review"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastError: { type: String, default: "" },
    scheduledAt: { type: Date, default: Date.now },
    processedAt: Date,
    result: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

const RefundJob = mongoose.model("RefundJob", schema, "refund_jobs");
module.exports = RefundJob;
