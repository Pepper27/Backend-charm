const mongoose = require("mongoose");
const Order = require("./models/order.model");
const RefundJob = require("./models/refundJob.model");

// Auto-cancel orders older than threshold (default 4 days)
// Default auto-cancel threshold (ms). For Zalopay unpaid orders we will prefer
// a shorter default to avoid long-held reservations. Can be configured via env.
const THRESHOLD_MS = Number(process.env.AUTO_CANCEL_THRESHOLD_MS || 30 * 60 * 1000); // 30 minutes
const BATCH_LIMIT = Number(process.env.AUTO_CANCEL_BATCH_LIMIT || 50);

async function runOnce() {
  const cutoff = new Date(Date.now() - THRESHOLD_MS);
  const orders = await Order.find({ status: "pending", cancelledAt: null, createdAt: { $lte: cutoff } })
    .limit(BATCH_LIMIT)
    .exec();

  for (const order of orders) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      // idempotent guard
      if (order.status !== "pending" || order.cancelledAt) {
        await session.abortTransaction();
        continue;
      }
      order.status = "cancelled";
      order.cancelledAt = new Date();
      order.cancelledBy = "system";
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({ status: "cancelled", changedAt: new Date(), changedBy: "system", note: "auto-cancel: pending > 4 days" });

      // restock per-line
      const variantIds = [];
      for (const line of order.cart) {
        if (!line.stockReleased) {
          variantIds.push({ variantId: line.variantId, quantity: line.quantity });
          line.stockReleased = true;
        }
      }

      await order.save({ session });

      const Product = require("./models/product.model");
      for (const v of variantIds) {
        await Product.updateOne({ "variants._id": v.variantId }, { $inc: { "variants.$.quantity": v.quantity } }, { session });
      }

      // enqueue refund job if needed
      if ((order.method === "zalopay" || (order.payment && order.payment.provider === "zalopay")) && order.payment?.capturedAmount > 0) {
        order.payment = order.payment || {};
        order.payment.refundStatus = "pending";
        const job = new RefundJob({ orderId: order._id, orderCode: order.orderCode, provider: "zalopay", payload: { amount: order.payment.capturedAmount, providerChargeId: order.payment.providerChargeId || "" } });
        await job.save({ session });
        order.payment.refunds = order.payment.refunds || [];
        order.payment.refunds.push({ amount: order.payment.capturedAmount, createdAt: new Date(), status: "pending" });
        await order.save({ session });
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      console.error("autoCancel error", err);
    } finally {
      session.endSession();
    }
  }
}

module.exports = { runOnce };

if (require.main === module) {
  // simple scheduler every hour
  console.log("Starting auto-cancel job (hourly)...");
  setInterval(runOnce, Number(process.env.AUTO_CANCEL_INTERVAL_MS || 60 * 60 * 1000));
  runOnce();
}
