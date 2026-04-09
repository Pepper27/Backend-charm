const moment = require("moment");
const Order = require("../../models/order.model");
const Product = require("../../models/product.model");
const AccountClient = require("../../models/accountClient.model");
const Category = require("../../models/category.model");

const STATUS_MAP = {
  pending: "initial",
  confirmed: "initial",
  shipping: "ship",
  delivered: "done",
  cancelled: "cancel",
};

const METHOD_MAP = {
  cash: "Tiền mặt",
  zalopay: "ZaloPay",
};

const PAY_STATUS_MAP = {
  unpaid: "Chưa thanh toán",
  paid: "Đã thanh toán",
};

module.exports.getDashboard = async (req, res) => {
  try {
    const thresholdAlmostOver = 5; 

    const [
      totalClient,
      totalProductAgg,
      orderCount,
      revenueAgg,
      orderNewRaw,
      categoryList,
      productsRaw,
      topOrdersRaw,
      allProductsRaw,
    ] = await Promise.all([
      AccountClient.countDocuments({ deleted: false }),
      Product.aggregate([
        { $match: { deleted: false } },
        { $unwind: { path: "$variants", preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, sum: { $sum: { $ifNull: ["$variants.quantity", 0] } } } },
      ]),
      Order.countDocuments({ deleted: false }),
      Order.aggregate([
        { $match: { deleted: false, status: "delivered" } },
        { $group: { _id: null, sum: { $sum: "$totalPrice" } } },
      ]),

      Order.find({ deleted: false })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("userId", "fullName")
        .lean(),
      Category.find({ deleted: false, parent: "" })
        .sort({ position: 1 })
        .select({ _id: 1, name: 1 })
        .lean(),
      Product.find({ deleted: false })
        .select({ name: 1, variants: 1 })
        .lean(),

      Order.find({
        deleted: false,
        payStatus: "paid",
        status: { $ne: "cancelled" },
      })
        .select({ cart: 1, totalPrice: 1 })
        .lean(),
      Product.find({})
        .select({ name: 1, variants: 1 })
        .lean(),
    ]);

    const dashboard = {
      order: orderCount,
      priceTotal: revenueAgg?.[0]?.sum || 0,
    };
    const totalProduct = totalProductAgg?.[0]?.sum || 0;

    const products = productsRaw || [];
    let almostOver = 0;
    let soldOut = 0;
    let many = 0;

    const computedTopProduct = products
      .map((p) => {
        const variants = p?.variants || [];

        for (const v of variants) {
          const q = Number(v?.quantity || 0);
          if (q === 0) soldOut += 1;
          else if (q <= thresholdAlmostOver) almostOver += 1;
          else many += 1;
        }

        return { name: p?.name || "", sold: 0, profit: 0 };
      })
      .slice(0, 5);

    const productMap = new Map(products.map((p) => [String(p?._id || ""), p]));
    const allProductMap = new Map(
      (allProductsRaw || []).map((p) => [String(p?._id || ""), p])
    );

    const topAccumulator = new Map();
    for (const order of topOrdersRaw || []) {
      const cart = order?.cart || [];
      if (!cart.length) continue;

      const lineTotals = cart.map(
        (it) => (Number(it?.quantity || 0) * Number(it?.price || 0))
      );
      const sumLine = lineTotals.reduce((a, b) => a + b, 0);
      const orderTotal = Number(order?.totalPrice || 0);

      cart.forEach((it, idx) => {
        const pid = String(it?.productId || "");
        if (!pid) return;

        const qty = Number(it?.quantity || 0);
        const lineTotal = Number(lineTotals[idx] || 0);
        const allocatedRevenue =
          cart.length === 1
            ? orderTotal
            : sumLine > 0
              ? (orderTotal * lineTotal) / sumLine
              : lineTotal;

        if (!topAccumulator.has(pid)) {
          topAccumulator.set(pid, {
            productId: pid,
            sold: 0,
            profit: 0,
          });
        }
        const cur = topAccumulator.get(pid);
        cur.sold += qty;
        cur.profit += allocatedRevenue;
      });
    }

    const topProduct = Array.from(topAccumulator.values())
      .sort((a, b) => b.sold - a.sold || b.profit - a.profit)
      .slice(0, 5)
      .map((item) => ({
        name: allProductMap.get(item.productId)?.name || "Không rõ",
        sold: Number(item.sold || 0),
        profit: Math.round(Number(item.profit || 0)),
      }));

    const topProductFinal = topProduct.length ? topProduct : computedTopProduct;

    const formattedOrderNew = (orderNewRaw || []).map((order) => {
      const m = moment(order.createdAt);
      const orderCart = (order?.cart || []).map((it) => {
        const product =
          allProductMap.get(String(it?.productId || "")) ||
          productMap.get(String(it?.productId || ""));
        const variant = (product?.variants || []).find(
          (v) => String(v?._id || "") === String(it?.variantId || "")
        );
        const variantImage = Array.isArray(variant?.images) && variant.images.length
          ? variant.images[0]
          : "";

        return {
          avatar: it?.image || it?.avatar || variantImage || "",
          name: it?.name || product?.name || "",
          quantity: it?.quantity || 0,
          priceLast: it?.price || variant?.price || 0,
        };
      });

      const statusKey = order?.status;
      const mappedStatus = STATUS_MAP[statusKey] || "cancel";

      const methodKey = order?.method;
      const mappedMethod = METHOD_MAP[methodKey] || methodKey || "";

      const payStatusKey = order?.payStatus;
      const mappedPayStatus =
        PAY_STATUS_MAP[payStatusKey] || payStatusKey || "";

      return {
        orderCode: order?.orderCode || "",
        fullName: order?.userId?.fullName || "",
        phone: order?.phone || "",
        note: order?.address || "",
        cart: orderCart,
        priceTotal: order?.totalPrice || 0,
        nameMethod: mappedMethod,
        nameStatusPay: mappedPayStatus,
        status: mappedStatus,
        formatTime: m.isValid() ? m.format("HH:mm") : "",
        formatDay: m.isValid() ? m.format("DD/MM/YYYY") : "",
      };
    });

    const data = {
      totalClient,
      totalProduct,
      dashboard,
      categoryList: (categoryList || []).map((c) => ({
        id: c._id,
        name: c.name,
      })),
      almostOver,
      soldOut,
      many,
      topProduct: topProductFinal,
      orderNew: formattedOrderNew,
    };

    return res.status(200).json({ data });
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi khi lấy dashboard",
      error: error.message,
    });
  }
};

module.exports.revenueChart = async (req, res) => {
  try {
    const { currentMonth, currentYear, previousMonth, previousYear, arrayDay } = req.body || {};

    const safeArrayDay = Array.isArray(arrayDay) ? arrayDay.map((d) => Number(d)) : [];
    if (!currentMonth || !currentYear || !previousMonth || !previousYear || !safeArrayDay.length) {
      return res.status(400).json({ code: "error", message: "Thiếu dữ liệu biểu đồ doanh thu" });
    }

    const startCurrent = new Date(Number(currentYear), Number(currentMonth) - 1, 1);
    const endCurrent = new Date(Number(currentYear), Number(currentMonth), 1);
    const startPrevious = new Date(Number(previousYear), Number(previousMonth) - 1, 1);
    const endPrevious = new Date(Number(previousYear), Number(previousMonth), 1);

    const [orderCurrent, orderPrevious] = await Promise.all([
      Order.find({
        deleted: false,
        payStatus: "paid",
        createdAt: { $gte: startCurrent, $lt: endCurrent },
      }).lean(),
      Order.find({
        deleted: false,
        payStatus: "paid",
        createdAt: { $gte: startPrevious, $lt: endPrevious },
      }).lean(),
    ]);

    const dataMonthCurrent = [];
    const dataMonthPrevious = [];

    for (const day of safeArrayDay) {
      let total = 0;
      for (const item of orderCurrent) {
        const orderDate = new Date(item.createdAt).getDate();
        if (day === orderDate) total += item.totalPrice || 0;
      }
      dataMonthCurrent.push(total);
    }

    for (const day of safeArrayDay) {
      let total = 0;
      for (const item of orderPrevious) {
        const orderDate = new Date(item.createdAt).getDate();
        if (day === orderDate) total += item.totalPrice || 0;
      }
      dataMonthPrevious.push(total);
    }

    return res.status(200).json({
      code: "success",
      dataMonthCurrent,
      dataMonthPrevious,
    });
  } catch (error) {
    return res.status(500).json({
      code: "error",
      message: "Lỗi khi lấy biểu đồ doanh thu",
      error: error.message,
    });
  }
};

module.exports.inventory = async (req, res) => {
  try {
    const categoryCurrent = req.query.category || "";
    if (!categoryCurrent) {
      return res.status(200).json({ result: [] });
    }

    const allCategories = await Category.find({ deleted: false })
      .select({ _id: 1, name: 1, parent: 1 })
      .lean();

    const byId = new Map();
    for (const c of allCategories) {
      byId.set(String(c._id), c);
    }

    const getChildren = (parentId) =>
      allCategories.filter((c) => String(c.parent || "") === String(parentId));

    const collectDescendantIds = (startId) => {
      const stack = [String(startId)];
      const acc = new Set([String(startId)]);

      while (stack.length) {
        const cur = stack.pop();
        const children = getChildren(cur);
        for (const child of children) {
          const childId = String(child._id);
          if (!acc.has(childId)) {
            acc.add(childId);
            stack.push(childId);
          }
        }
      }
      return Array.from(acc);
    };

    const directChildren = getChildren(categoryCurrent);

    const buckets = directChildren.length
      ? directChildren.map((c) => ({ id: String(c._id), name: c.name }))
      : (() => {
          const current = byId.get(String(categoryCurrent));
          if (!current) return [];
          return [{ id: String(current._id), name: current.name }];
        })();

    const bucketDescMap = new Map();
    for (const b of buckets) {
      bucketDescMap.set(b.id, new Set(collectDescendantIds(b.id)));
    }

    const result = buckets.map((b) => ({ id: b.id, name: b.name, count: 0 }));

    const products = await Product.find({ deleted: false })
      .select({ category: 1, variants: 1 })
      .lean();

    for (const product of products) {
      const productCategoryId = String(product?.category || "");
      if (!productCategoryId) continue;

      const productQty = (product?.variants || []).reduce(
        (sum, v) => sum + (Number(v?.quantity) || 0),
        0
      );

      for (const item of result) {
        const descendants = bucketDescMap.get(item.id);
        if (descendants?.has(productCategoryId)) {
          item.count += productQty;
        }
      }
    }

    return res.status(200).json({ result });
  } catch (err) {
    return res.status(500).json({ code: "error", message: "Server Error", error: err.message });
  }
};

