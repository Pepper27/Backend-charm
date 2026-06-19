const Order = require("../../../models/order.model");
const v1 = require("../../../helper/v1-response.helper");
const mongoose = require("mongoose");
const Product = require("../../../models/product.model");
const { createReturnRequest } = require("../../../services/orders/return-request.service");

const normalizeStatus = (value) => String(value || "").trim();

const inferPayStatus = (o) => {
  try {
    if (!o) return "unpaid";
    // Prefer explicit DB payStatus set by webhook/confirm
    if (o.payStatus === "paid") return "paid";
    // Consider payment captured or provider transaction id as proof of payment
    const captured = Number((o.payment && o.payment.capturedAmount) || 0);
    const zpTransId = String((o.payment && o.payment.zpTransId) || "").trim();
    if (captured > 0 || zpTransId) return "paid";
    return "unpaid";
  } catch (e) {
    return "unpaid";
  }
};

const imageForVariant = (variant) => {
  const img = variant?.images?.[0];
  return typeof img === "string" && img.trim() ? img.trim() : "";
};

const enrichCartVariantMeta = async (orders) => {
  const list = Array.isArray(orders) ? orders : [];
  const variantIds = [];
  for (const o of list) {
    for (const line of Array.isArray(o?.cart) ? o.cart : []) {
      const hasAny =
        (line?.material && String(line.material).trim()) ||
        (line?.color && String(line.color).trim()) ||
        (line?.size && String(line.size).trim()) ||
        (line?.image && String(line.image).trim());
      if (!hasAny && line?.variantId) variantIds.push(String(line.variantId));
    }
  }
  const unique = [...new Set(variantIds)].filter(Boolean);
  if (!unique.length) return;

  const products = await Product.find({ "variants._id": { $in: unique } })
    .select("variants")
    .lean();
  const byVariantId = new Map();
  for (const p of products || []) {
    for (const v of Array.isArray(p?.variants) ? p.variants : []) {
      const id = String(v?._id || "");
      if (!id) continue;
      if (!byVariantId.has(id)) {
        byVariantId.set(id, {
          material: String(v?.material || ""),
          color: String(v?.color || ""),
          size: String(v?.size || ""),
          image: imageForVariant(v),
        });
      }
    }
  }

  for (const o of list) {
    for (const line of Array.isArray(o?.cart) ? o.cart : []) {
      const meta = byVariantId.get(String(line?.variantId || ""));
      if (!meta) continue;
      if (!line.material) line.material = meta.material;
      if (!line.color) line.color = meta.color;
      if (!line.size) line.size = meta.size;
      if (!line.image && meta.image) line.image = meta.image;
    }
  }
};

// GET /api/v1/client/orders/stats
// Returns badge counts for client order hub.
module.exports.stats = async (req, res) => {
  try {
    if (!req.auth?.id || req.auth.role !== "client") {
      return v1.fail(res, 401, "UNAUTHORIZED", "Missing client identity");
    }

    const userId = String(req.auth.id);
    const pipeline = [
      { $match: { deleted: false, userId: userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ];

    const rows = await Order.aggregate(pipeline);
    const byStatus = new Map((rows || []).map((r) => [String(r._id), Number(r.count) || 0]));

    return v1.ok(res, {
      pending: byStatus.get("pending") || 0,
      confirmed: byStatus.get("confirmed") || 0,
      shipping: byStatus.get("shipping") || 0,
    });
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// GET /api/v1/client/orders?status=pending|confirmed|shipping|delivered|cancelled&page=&limit=
module.exports.list = async (req, res) => {
  try {
    if (!req.auth?.id || req.auth.role !== "client") {
      return v1.fail(res, 401, "UNAUTHORIZED", "Missing client identity");
    }

    const userId = String(req.auth.id);
    const status = normalizeStatus(req.query.status);
    if (
      status &&
      !["pending", "confirmed", "shipping", "delivered", "cancelled"].includes(status)
    ) {
      return v1.fail(res, 400, "BAD_REQUEST", "Invalid status");
    }

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const parsedLimit = Number.parseInt(req.query.limit, 10) || 10;
    const limit = Math.min(Math.max(parsedLimit, 1), 50);

    const find = { deleted: false, userId };
    if (status) find.status = status;

    const total = await Order.countDocuments(find);
    const totalPage = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPage);
    const skip = (safePage - 1) * limit;

    const orders = await Order.find(find)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "orderCode totalPrice status method payStatus fullName email phone address createdAt updatedAt cart bundles payment returnRequest"
      )
      .lean();

    // Best-effort: enrich cart lines with variant meta for older orders.
    try {
      await enrichCartVariantMeta(orders);
    } catch {
      // ignore
    }

    // Ensure payStatus is present/inferred for client UI
    const withPay = (orders || []).map((o) => ({
      ...o,
      payStatus: o.payStatus || inferPayStatus(o),
    }));

    return v1.ok(res, withPay || [], {
      total,
      currentPage: safePage,
      totalPage,
      limit,
    });
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// GET /api/v1/client/orders/:orderCode
module.exports.getByCode = async (req, res) => {
  try {
    if (!req.auth?.id || req.auth.role !== "client") {
      return v1.fail(res, 401, "UNAUTHORIZED", "Missing client identity");
    }
    const userId = String(req.auth.id);
    const orderCode = String(req.params.orderCode || "").trim();
    if (!orderCode) {
      return v1.fail(res, 400, "BAD_REQUEST", "Missing orderCode");
    }

    const order = await Order.findOne({ deleted: false, userId, orderCode }).lean();
    if (!order) {
      return v1.fail(res, 404, "NOT_FOUND", "Order not found");
    }

    // infer payStatus if missing so client UI shows correct payment state
    order.payStatus = order.payStatus || inferPayStatus(order);
    try {
      await enrichCartVariantMeta([order]);
    } catch {
      // ignore
    }
    return v1.ok(res, order);
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// POST /api/v1/client/orders/:orderCode/cancel
module.exports.cancel = async (req, res) => {
  try {
    if (!req.auth?.id || req.auth.role !== "client") {
      return v1.fail(res, 401, "UNAUTHORIZED", "Missing client identity");
    }

    const userId = String(req.auth.id);
    const orderCode = String(req.params.orderCode || "").trim();
    if (!orderCode) return v1.fail(res, 400, "BAD_REQUEST", "Missing orderCode");

    const reason = String(req.body.reason || "").trim();

    // Start a transaction to update order atomically.
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const order = await Order.findOne({ deleted: false, userId, orderCode }).session(session);
      if (!order) {
        await session.abortTransaction();
        return v1.fail(res, 404, "NOT_FOUND", "Order not found");
      }

      const isPaidZaloPay =
        (String(order.method || "")
          .trim()
          .toLowerCase() === "zalopay" ||
          String(order?.payment?.provider || "")
            .trim()
            .toLowerCase() === "zalopay") &&
        inferPayStatus(order) === "paid";

      if (isPaidZaloPay) {
        await session.abortTransaction();
        const latest = await Order.findById(order._id).lean();
        return v1.fail(res, 409, "CONFLICT", "ZaloPay paid orders cannot be cancelled", latest);
      }

      // Allowed cancel statuses for customer
      if (!["pending", "confirmed"].includes(order.status)) {
        // Return conflict with latest snapshot so frontend can refresh
        await session.abortTransaction();
        const latest = await Order.findById(order._id).lean();
        return v1.fail(
          res,
          409,
          "CONFLICT",
          "Order cannot be cancelled in its current status",
          latest
        );
      }

      // Idempotent: if already cancelled by same user, return success with snapshot
      if (order.status === "cancelled") {
        await session.commitTransaction();
        return v1.ok(res, order);
      }

      // Update order status and cancel metadata
      order.status = "cancelled";
      order.cancelledAt = new Date();
      order.cancelledBy = "customer";
      order.cancelReason = reason || "";
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: "cancelled",
        changedAt: new Date(),
        changedBy: "customer",
        note: reason || "",
      });

      // Idempotent restock per line
      const variantIds = [];
      for (const line of order.cart) {
        if (!line.stockReleased) {
          variantIds.push({ variantId: line.variantId, quantity: line.quantity });
          line.stockReleased = true;
        }
      }

      // Persist order updates
      await order.save({ session });

      // Increase product variant stocks for released lines
      if (variantIds.length) {
        const Product = require("../../../models/product.model");
        for (const v of variantIds) {
          // Best-effort: update variant quantity atomically
          await Product.updateOne(
            { "variants._id": v.variantId },
            { $inc: { "variants.$.quantity": v.quantity } },
            { session }
          );
        }
      }

      await session.commitTransaction();

      // Return latest snapshot to client
      const latest = await Order.findById(order._id).lean();
      return v1.ok(res, latest);
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  } catch (error) {
    return v1.serverError(res, error);
  }
};

module.exports.requestReturn = async (req, res) => {
  try {
    if (!req.auth?.id || req.auth.role !== "client") {
      return v1.fail(res, 401, "UNAUTHORIZED", "Missing client identity");
    }

    const orderCode = String(req.params.orderCode || "").trim();
    const order = await createReturnRequest({
      orderCode,
      reason: req.body?.reason,
      images: req.body?.images,
      clientId: String(req.auth.id),
      guestId: "",
      email: "",
      phone: "",
    });

    return v1.created(res, order);
  } catch (error) {
    if (error && error.status) {
      return v1.fail(
        res,
        error.status,
        error.code || "ERROR",
        error.message || "Request failed",
        error.meta
      );
    }
    return v1.serverError(res, error);
  }
};
