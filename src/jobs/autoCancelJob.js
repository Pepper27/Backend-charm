const mongoose = require("mongoose");
const dotenv = require("dotenv");
const { connectDB } = require("../config/database");
const Order = require("../models/order.model");
const RefundJob = require("../models/refundJob.model");
const Product = require("../models/product.model");

dotenv.config();

// Auto-cancel logic
// For generic orders we may use AUTO_CANCEL_THRESHOLD_MS, but for external
// payment providers (ZaloPay) we prefer explicit payment.expiresAt on the order.
const THRESHOLD_MS = Number(process.env.AUTO_CANCEL_THRESHOLD_MS || 30 * 60 * 1000); // 30 minutes (fallback)
const BATCH_LIMIT = Number(process.env.AUTO_CANCEL_BATCH_LIMIT || 50);

async function runOnce() {
  const now = new Date();
  // Only auto-cancel unpaid ZaloPay orders that have passed their payment window.
  const orders = await Order.find({
    status: "pending",
    cancelledAt: null,
    method: "zalopay",
    payStatus: { $ne: "paid" },
    $or: [
      { "payment.expiresAt": { $exists: true, $lte: now } },
      { createdAt: { $lte: new Date(Date.now() - THRESHOLD_MS) } },
    ],
  })
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
      // If there's an associated appTransId, attempt to double-check the
      // payment status with ZaloPay before cancelling to avoid false cancels.
      const appTransId = order.payment?.appTransId || "";
      if (appTransId) {
        try {
          const cfg = {
            appId: String(process.env.ZALOPAY_ID || "").trim(),
            key1: String(process.env.ZALOPAYKEY1 || "").trim(),
            domain: String(process.env.ZALOPAYDOMAIN || "https://sb-openapi.zalopay.vn").trim(),
          };
          if (cfg.appId && cfg.key1) {
            const macData = [cfg.appId, appTransId, cfg.key1].join("|");
            const mac = require("crypto").createHmac("sha256", cfg.key1).update(macData).digest("hex");
            const params = new URLSearchParams();
            params.set("app_id", String(cfg.appId));
            params.set("app_trans_id", String(appTransId));
            params.set("mac", mac);
            const url = `${cfg.domain.replace(/\/$/, "")}/v2/query`;
            const resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params.toString(),
            });
            const data = await resp.json().catch(() => null);
            if (resp.ok && data && data.return_code === 1) {
              // Payment is actually completed — mark paid and skip cancelling.
              const amount = Number(data.amount || 0);
              const zpTransId = data.zp_trans_id || data.zp_trans_token || "";
              await Order.updateOne(
                { _id: order._id },
                {
                  $set: {
                    payStatus: "paid",
                    status: "confirmed",
                    "payment.provider": "zalopay",
                    "payment.capturedAmount": amount,
                    "payment.zpTransId": zpTransId,
                  },
                  $push: {
                    statusHistory: {
                      status: "confirmed",
                      changedAt: new Date(),
                      changedBy: "system",
                      note: "ZaloPay confirmed by auto-cancel job",
                    },
                  },
                }
              );
              await session.commitTransaction();
              continue; // skip cancellation
            }
          }
        } catch (e) {
          console.error("autoCancel: error querying ZaloPay for appTransId", appTransId, e);
          // fall through to cancellation path if query fails
        }
      }
      order.status = "cancelled";
      order.cancelledAt = new Date();
      order.cancelledBy = "system";
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: "cancelled",
        changedAt: new Date(),
        changedBy: "system",
        note: "auto-cancel: pending > 4 days",
      });

      // restock per-line
      const variantIds = [];
      for (const line of order.cart) {
        if (!line.stockReleased) {
          variantIds.push({ variantId: line.variantId, quantity: line.quantity });
          line.stockReleased = true;
        }
      }

      await order.save({ session });

      for (const v of variantIds) {
        await Product.updateOne(
          { "variants._id": v.variantId },
          { $inc: { "variants.$.quantity": v.quantity } },
          { session }
        );
      }

      // enqueue refund job if needed
      if (
        (order.method === "zalopay" || (order.payment && order.payment.provider === "zalopay")) &&
        order.payment?.capturedAmount > 0
      ) {
        order.payment = order.payment || {};
        order.payment.refundStatus = "pending";
        const idempotencyKey = `${order._id.toString()}_${Date.now()}`;
        const job = new RefundJob({
          orderId: order._id,
          orderCode: order.orderCode,
          provider: "zalopay",
          idempotencyKey,
          payload: {
            amount: order.payment.capturedAmount,
            providerChargeId: order.payment.providerChargeId || "",
            appTransId: order.payment?.appTransId || undefined,
          },
        });
        await job.save({ session });
        order.payment.refunds = order.payment.refunds || [];
        order.payment.refunds.push({
          amount: order.payment.capturedAmount,
          createdAt: new Date(),
          status: "pending",
          idempotencyKey,
        });
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

function startScheduler() {
  const intervalMs = Number(process.env.AUTO_CANCEL_INTERVAL_MS || 60 * 60 * 1000);
  console.log(`Starting auto-cancel job (${intervalMs}ms)...`);
  setInterval(runOnce, intervalMs);
  return runOnce();
}

module.exports = { runOnce, startScheduler };

if (require.main === module) {
  connectDB()
    .then(() => {
      return startScheduler();
    })
    .catch((err) => {
      console.error("Failed to start auto-cancel job", err);
      process.exit(1);
    });
}
