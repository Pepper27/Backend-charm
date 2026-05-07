const Order = require("../../models/order.model");

// Simple ZaloPay webhook and client confirm handlers.
// Webhook: called server-to-server by ZaloPay. Verifies a shared secret
// via header `x-zalopay-secret` matching process.env.ZALOPAY_WEBHOOK_SECRET.
// Confirm: used by frontend redirect/return flow to notify backend when
// the user returns from the payment provider (less secure than webhook,
// but useful for demo/redirect flows).

const safeNum = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

module.exports.webhook = async (req, res) => {
  try {
    const secretHeader = String(req.headers["x-zalopay-secret"] || "");
    const expected = String(process.env.ZALOPAY_WEBHOOK_SECRET || "");
    if (!expected || !secretHeader || secretHeader !== expected) {
      return res.status(401).json({ message: "Unauthorized webhook" });
    }

    const body = req.body || {};
    // Accept either providerChargeId or orderCode from provider callback
    const providerChargeId = String(body.providerChargeId || body.chargeId || "").trim();
    const orderCode = String(body.orderCode || "").trim();
    const status = String(body.status || body.event || "").toLowerCase();
    const amount = safeNum(body.amount || body.total || 0);

    if (!providerChargeId && !orderCode) {
      return res.status(400).json({ message: "Missing providerChargeId or orderCode" });
    }

    // Find order by providerChargeId first, fallback to orderCode
    const query = providerChargeId ? { "payment.providerChargeId": providerChargeId } : { orderCode };
    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Only handle capture/succeeded events here to mark order as paid.
    if (status && !(status.includes("capture") || status.includes("paid") || status.includes("succeed") || status.includes("success"))) {
      // For other events, just return 200 so provider doesn't retry.
      return res.status(200).json({ message: "Event ignored" });
    }

    // Update order payment snapshot. If amount is missing, do not overwrite existing capturedAmount.
    const update = {
      $set: {
        payStatus: "paid",
        "payment.provider": "zalopay",
      },
    };
    if (providerChargeId) update.$set["payment.providerChargeId"] = providerChargeId;
    if (amount > 0) update.$set["payment.capturedAmount"] = amount;

    await Order.updateOne({ _id: order._id }, update);

    return res.status(200).json({ message: "OK" });
  } catch (err) {
    console.error("Zalo webhook error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

// Client-side confirm endpoint. The frontend can call this after redirecting
// back from the provider with providerChargeId and orderCode. This is not a
// replacement for the webhook but helps update DB for redirect-only flows.
module.exports.confirm = async (req, res) => {
  try {
    const body = req.body || {};
    const providerChargeId = String(body.providerChargeId || body.chargeId || "").trim();
    const orderCode = String(body.orderCode || "").trim();
    const amount = safeNum(body.amount || body.total || 0);

    if (!orderCode || !providerChargeId) {
      return res.status(400).json({ message: "Missing orderCode or providerChargeId" });
    }

    const order = await Order.findOne({ orderCode });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only allow confirm for Zalopay orders (defensive)
    if (order.method !== "zalopay" && !(order.payment && order.payment.provider === "zalopay")) {
      return res.status(400).json({ message: "Order payment method is not Zalopay" });
    }

    // Update DB - do not lower an existing capturedAmount
    const update = { $set: { payStatus: "paid", "payment.provider": "zalopay", "payment.providerChargeId": providerChargeId } };
    if (amount > 0) update.$set["payment.capturedAmount"] = amount;

    await Order.updateOne({ _id: order._id }, update);

    const updated = await Order.findOne({ _id: order._id }).lean();
    return res.status(200).json({ message: "OK", data: updated });
  } catch (err) {
    console.error("Zalo confirm error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};
