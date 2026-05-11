const Order = require("../../models/order.model");
const Cart = require("../../models/cart.model");
const crypto = require("crypto");

const safeNum = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

const zalopayConfig = () => {
  return {
    appId: String(process.env.ZALOPAY_ID || "").trim(),
    key1: String(process.env.ZALOPAYKEY1 || "").trim(),
    key2: String(process.env.ZALOPAYKEY2 || "").trim(),
    domain: String(process.env.ZALOPAYDOMAIN || "https://sb-openapi.zalopay.vn").trim(),
  };
};

const pullCartByOrderSnapshot = async (order) => {
  try {
    if (!order || !order.checkoutSnapshot) return;
    const cartKey = order.userId ? { userId: String(order.userId) } : { guestId: String(order.guestId || "") };
    const { bundleIds = [], productLineIds = [], buyNowVariantIds = [] } = order.checkoutSnapshot || {};
    const update = {};
    if (bundleIds && bundleIds.length) update.$pull = { bundles: { bundleId: { $in: bundleIds } } };
    if (productLineIds && productLineIds.length) update.$pull = update.$pull || {};
    if (productLineIds && productLineIds.length) update.$pull.products = { _id: { $in: productLineIds } };

    if (buyNowVariantIds && buyNowVariantIds.length) {
      update.$pull = update.$pull || {};
      const existing = update.$pull.products || {};
      update.$pull.products = {
        $or: [...(existing && Object.keys(existing).length ? [existing] : []), { variantId: { $in: buyNowVariantIds } }],
      };
    }

    if (Object.keys(update).length) {
      await Cart.updateOne(cartKey, update);
    }
  } catch (err) {
    console.error("Error pulling cart for order cleanup:", err);
  }
};

// Webhook handler follows Zalopay callback spec: body = { data: <json string>, mac: <hmac>, type }
module.exports.webhook = async (req, res) => {
  try {
    const body = req.body || {};
    const dataStr = String(body.data || "");
    const mac = String(body.mac || "");
    const cfg = zalopayConfig();
    if (!cfg.key2) {
      return res.status(500).json({ message: "ZaloPay key2 not configured" });
    }
    const expected = crypto.createHmac("sha256", cfg.key2).update(dataStr).digest("hex");
    if (expected !== mac) {
      return res.status(401).json({ message: "Invalid mac" });
    }

    let data = null;
    try { data = JSON.parse(dataStr); } catch (e) { }
    if (!data) return res.status(400).json({ message: "Invalid data payload" });
    console.log("ZALOPAY WEBHOOK DATA:", data);

    const appTransId = String(data.app_trans_id || "");

    console.log("APP TRANS ID:", appTransId);
    // embed_data may include orderCode
    let embed = {};
    try { embed = JSON.parse(String(data.embed_data || "{}")); } catch (e) { embed = {}; }
    const orderCode = String(embed.orderCode || data.order_code || "");

    // Try find by appTransId or orderCode
    const query = appTransId ? { "payment.appTransId": appTransId } : (orderCode ? { orderCode } : null);
    if (!query) return res.status(400).json({ message: "Missing identifiers" });

    const order = await Order.findOne(query);
    console.log("ORDER FOUND:", order);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // If already paid, return OK (idempotent)
    if (order.payStatus === "paid") return res.status(200).json({ message: "Already paid" });

    const amount = safeNum(data.amount || data.total || 0);
    const zpTransId = data.zp_trans_id || data.zp_trans_token || "";

    //await Order.updateOne({ _id: order._id }, { $set: { payStatus: "paid", "payment.provider": "zalopay", "payment.capturedAmount": amount || order.payment?.capturedAmount || 0, "payment.zpTransId": zpTransId } });
    // await Order.updateOne(
    //   { _id: order._id },
    //   {
    //     $set: {
    //       payStatus: "paid",
    //       status: "confirmed",
    //       "payment.provider": "zalopay",
    //       "payment.capturedAmount":
    //         amount || order.payment?.capturedAmount || 0,
    //       "payment.zpTransId": zpTransId,
    //     },
    //     $push: {
    //       statusHistory: {
    //         status: "confirmed",
    //         changedAt: new Date(),
    //         changedBy: "system",
    //         note: "ZaloPay payment success",
    //       },
    //     },
    //   }
    // );
    // Thay đoạn update cũ bằng đoạn này:
    const result = await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          payStatus: "paid",
          status: "confirmed",
          "payment.provider": "zalopay",
          "payment.capturedAmount": amount || order.totalPrice || 0, // Dùng totalPrice nếu amount từ zalo bị trống
          "payment.zpTransId": zpTransId,
          "payment.appTransId": appTransId // Cập nhật ngược lại ID này nếu trong DB chưa có
        },
        $push: {
          statusHistory: {
            status: "confirmed",
            changedAt: new Date(),
            changedBy: "system",
            note: "ZaloPay payment success (Manual Test)",
          },
        },
      }
    );

    console.log("KẾT QUẢ UPDATE DB:", result); // Dòng này cực kỳ quan trọng để check
    // Cleanup cart according to snapshot
    await pullCartByOrderSnapshot(order);

    return res.status(200).json({ message: "OK" });
  } catch (err) {
    console.error("Zalo webhook error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};

// Client confirm: frontend calls this on redirect return. We call ZaloPay /v2/query to verify.
module.exports.confirm = async (req, res) => {
  try {
    const body = req.body || {};
    const appTransId = String(body.appTransId || body.app_trans_id || "").trim();
    const orderCode = String(body.orderCode || "").trim();
    const cfg = zalopayConfig();
    if (!cfg.appId || !cfg.key1) return res.status(500).json({ message: "ZaloPay credentials not configured" });

    // Determine which appTransId to query: prefer provided, else fetch from order via orderCode
    let resolvedAppTransId = appTransId;
    if (!resolvedAppTransId) {
      if (!orderCode) return res.status(400).json({ message: "Missing appTransId or orderCode" });
      const order = await Order.findOne({ orderCode }).lean();
      if (!order) return res.status(404).json({ message: "Order not found" });
      resolvedAppTransId = order.payment?.appTransId || "";
    }

    if (!resolvedAppTransId) return res.status(400).json({ message: "Missing appTransId" });

    // Build query MAC: app_id|app_trans_id|key1
    const macData = [cfg.appId, resolvedAppTransId, cfg.key1].join("|");
    const mac = crypto.createHmac("sha256", cfg.key1).update(macData).digest("hex");

    const params = new URLSearchParams();
    params.set("app_id", String(cfg.appId));
    params.set("app_trans_id", resolvedAppTransId);
    params.set("mac", mac);

    const url = `${cfg.domain.replace(/\/$/, "")}/v2/query`;
    const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) return res.status(500).json({ message: "ZaloPay query failed" });

    // data.return_code === 1 means success. sub_return_message may include details
    if (data.return_code !== 1) {
      return res.status(200).json({ message: "Not paid", data });
    }

    // Mark order paid and cleanup
    // app_trans_id may contain orderCode suffix
    const orderQuery = { "payment.appTransId": resolvedAppTransId };
    let order = await Order.findOne(orderQuery);
    if (!order && orderCode) order = await Order.findOne({ orderCode });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.payStatus !== "paid") {
      const amount = safeNum(data.amount || 0);
      const zpTransId = data.zp_trans_id || data.zp_trans_token || "";
      //await Order.updateOne({ _id: order._id }, { $set: { payStatus: "paid", "payment.provider": "zalopay", "payment.capturedAmount": amount, "payment.zpTransId": zpTransId } });
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
              note: "ZaloPay confirm success",
            },
          },
        }
      );
      // cleanup cart
      await pullCartByOrderSnapshot(order);
    }

    const updated = await Order.findOne({ _id: order._id }).lean();
    return res.status(200).json({ message: "OK", data: updated });
  } catch (err) {
    console.error("Zalo confirm error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
};
