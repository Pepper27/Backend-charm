/*
 Simple DB-backed refund worker.
 Polls refund_jobs for pending items and processes them using the mock zalopay adapter.
 This is intentionally small: it marks jobs processing, calls adapter, writes results and updates order.payment.
*/
const mongoose = require("mongoose");
const RefundJob = require("../models/refundJob.model");
const Order = require("../models/order.model");

// Mock Zalopay adapter - replace with real provider later
const zalopayAdapter = async (payload) => {
  // payload: { amount, providerChargeId }
  // Simulate success most of the time, transient failure sometimes.
  const r = Math.random();
  if (r < 0.8) {
    return { success: true, id: `mock_ref_${Date.now()}`, raw: { simulated: true } };
  }
  if (r < 0.95) {
    const err = new Error("Transient network error");
    err.transient = true;
    throw err;
  }
  const err = new Error("Permanent provider refusal");
  err.transient = false;
  throw err;
};

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
    const res = await zalopayAdapter(job.payload);
    job.status = "succeeded";
    job.processedAt = new Date();
    job.result = res;
    await job.save();

    // Update order payment record
    await Order.updateOne(
      { _id: job.orderId },
      {
        $set: {
          "payment.refundStatus": "succeeded",
        },
        $push: { "payment.refunds": { amount: job.payload.amount, createdAt: new Date(), status: "succeeded", providerResponse: res } },
      }
    );
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
          $push: { "payment.refunds": { amount: job.payload.amount, createdAt: new Date(), status: "manual_review", providerResponse: { error: job.lastError } } },
        }
      );
    } else {
      // exhausted attempts
      job.status = "failed";
      await Order.updateOne(
        { _id: job.orderId },
        {
          $set: { "payment.refundStatus": "failed" },
          $push: { "payment.refunds": { amount: job.payload.amount, createdAt: new Date(), status: "failed", providerResponse: { error: job.lastError } } },
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
