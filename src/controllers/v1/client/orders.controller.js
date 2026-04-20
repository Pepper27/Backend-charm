const Order = require("../../../models/order.model");
const v1 = require("../../../helper/v1-response.helper");

const normalizeStatus = (value) => String(value || "").trim();

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
        "orderCode totalPrice status method payStatus fullName email phone address createdAt updatedAt cart bundles"
      )
      .lean();

    return v1.ok(res, orders || [], {
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

    return v1.ok(res, order);
  } catch (error) {
    return v1.serverError(res, error);
  }
};
