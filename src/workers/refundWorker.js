/*
 Simple DB-backed refund worker.
 Polls refund_jobs for pending items and processes them using the mock zalopay adapter.
 This is intentionally small: it marks jobs processing, calls adapter, writes results and updates order.payment.
*/
const mongoose = require("mongoose");
const RefundJob = require("../models/refundJob.model");
const Order = require("../models/order.model");

// Real ZaloPay adapter
const { zalopayRefund } = require("../adapters/zalopay.adapter");

const PROCESS_INTERVAL_MS = Number(process.env.REFUND_WORKER_INTERVAL_MS || 5000);
const MAX_CONCURRENT = Number(process.env.REFUND_WORKER_CONCURRENCY || 2);

let running = false;

async function processOne() {
  // find one pending job scheduled in the past
  const job = await RefundJob.findOneAndUpdate(
    { status: "pending", scheduledAt: { $lte: new Date() } },
    { $set: { status: "processing", attempts: 1 } },
    { new: true }
  );
  if (!job) return false;

  try {
    // Idempotency: check if order already has a successful refund with same idempotencyKey or providerRefundId
    const order = await Order.findById(job.orderId).lean();
    if (!order) {
      job.status = "failed";
      job.lastError = "Order not found";
      await job.save();
      return true;
    }

    const already = (
      order.payment && Array.isArray(order.payment.refunds) ? order.payment.refunds : []
    ).find((r) => {
      if (!r) return false;
      if (job.idempotencyKey && r.idempotencyKey && r.idempotencyKey === job.idempotencyKey)
        return true;
      if (job.providerRefundId && r.providerRefundId && r.providerRefundId === job.providerRefundId)
        return true;
      return false;
    });
    if (already && (already.status === "succeeded" || already.status === "processing")) {
      // Nothing to do
      job.status = "succeeded";
      job.processedAt = new Date();
      job.result = { note: "skipped - already processed" };
      await job.save();
      return true;
    }

    // Call provider adapter
    const res = await zalopayRefund({
      appTransId: job.payload.appTransId || job.payload.providerChargeId || job.orderCode,
      amount: job.payload.amount,
      description: `Refund for order ${job.orderCode}`,
      idempotencyKey: job.idempotencyKey || `${job.orderId}_${job._id}`,
    });

    job.result = res;
    job.processedAt = new Date();

    if (res && res.status === "succeeded") {
      job.status = "succeeded";
      if (res.providerRefundId) job.providerRefundId = String(res.providerRefundId);
      await job.save();

      // Update order payment record with provider info
      await Order.updateOne(
        { _id: job.orderId },
        {
          $set: { "payment.refundStatus": "succeeded" },
          $push: {
            "payment.refunds": {
              amount: job.payload.amount,
              createdAt: new Date(),
              status: "succeeded",
              providerResponse: res,
              providerRefundId: res.providerRefundId || null,
              idempotencyKey: job.idempotencyKey || `${job.orderId}_${job._id}`,
            },
          },
        }
      );
    } else {
      // treat as failure (res may contain more info)
      job.lastError = res && res.message ? String(res.message) : "refund_failed";
      const isTransient = false; // treat provider non-success as permanent unless adapter throws transient
      job.attempts = (job.attempts || 0) + 1;
      if (isTransient && job.attempts < (job.maxAttempts || 5)) {
        job.status = "pending";
        const delay = Math.min(60 * 60 * 1000, Math.pow(2, job.attempts) * 1000);
        job.scheduledAt = new Date(Date.now() + delay);
      } else {
        // move to manual review so admin can inspect and refund manually
        job.status = "manual_review";
        await Order.updateOne(
          { _id: job.orderId },
          {
            $set: { "payment.refundStatus": "manual_review" },
            $push: {
              "payment.refunds": {
                amount: job.payload.amount,
                createdAt: new Date(),
                status: "manual_review",
                providerResponse: res,
                idempotencyKey: job.idempotencyKey || `${job.orderId}_${job._id}`,
              },
            },
          }
        );
        await job.save();
      }
    }
  } catch (err) {
    // transient errors -> retry
    job.attempts = (job.attempts || 0) + 1;
    job.lastError = String(err && err.message) || "unknown";
    const isTransient = !!err.transient;
    if (isTransient && job.attempts < (job.maxAttempts || 5)) {
      job.status = "pending";
      // exponential backoff: schedule next attempt
      const delay = Math.min(60 * 60 * 1000, Math.pow(2, job.attempts) * 1000);
      job.scheduledAt = new Date(Date.now() + delay);
    } else if (!isTransient) {
      job.status = "manual_review";
      // mark order refundStatus accordingly
      await Order.updateOne(
        { _id: job.orderId },
        {
          $set: { "payment.refundStatus": "manual_review" },
          $push: {
            "payment.refunds": {
              amount: job.payload.amount,
              createdAt: new Date(),
              status: "manual_review",
              providerResponse: { error: job.lastError },
              idempotencyKey: job.idempotencyKey || `${job.orderId}_${job._id}`,
            },
          },
        }
      );
    } else {
      // exhausted attempts
      job.status = "failed";
      await Order.updateOne(
        { _id: job.orderId },
        {
          $set: { "payment.refundStatus": "failed" },
          $push: {
            "payment.refunds": {
              amount: job.payload.amount,
              createdAt: new Date(),
              status: "failed",
              providerResponse: { error: job.lastError },
              idempotencyKey: job.idempotencyKey || `${job.orderId}_${job._id}`,
            },
          },
        }
      );
    }

    await job.save();
  }

  return true;
}

async function loop() {
  if (running) return;
  running = true;
  try {
    const promises = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      promises.push(processOne());
    }
    await Promise.all(promises);
  } finally {
    running = false;
    setTimeout(loop, PROCESS_INTERVAL_MS);
  }
}

if (require.main === module) {
  // connect to DB using existing env config in project index.js
  const config = require("../index");
  // assume that index.js will connect; otherwise consumer should require app's connection
  console.log("Starting refund worker...");
  loop();
}

module.exports = { loop, processOne };
