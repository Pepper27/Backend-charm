// const moment = require("moment");
// const Order = require("../../models/order.model");
// const Product = require("../../models/product.model");
// const AccountClient = require("../../models/accountClient.model");
// const Category = require("../../models/category.model");

// const STATUS_MAP = {
//   pending: "initial",
//   confirmed: "initial",
//   shipping: "ship",
//   delivered: "done",
//   cancelled: "cancel",
// };

// const METHOD_MAP = {
//   cash: "Tiền mặt",
//   zalopay: "ZaloPay",
// };

// const PAY_STATUS_MAP = {
//   unpaid: "Chưa thanh toán",
//   paid: "Đã thanh toán",
// };

// module.exports.getDashboard = async (req, res) => {
//   try {
//     const thresholdAlmostOver = 5;

//     const [
//       totalClient,
//       totalProductAgg,
//       orderCount,
//       revenueAgg,
//       orderNewRaw,
//       categoryList,
//       productsRaw,
//       topOrdersRaw,
//       allProductsRaw,
//     ] = await Promise.all([
//       AccountClient.countDocuments({ deleted: false }),
//       Product.aggregate([
//         { $match: { deleted: false } },
//         { $unwind: { path: "$variants", preserveNullAndEmptyArrays: true } },
//         { $group: { _id: null, sum: { $sum: { $ifNull: ["$variants.quantity", 0] } } } },
//       ]),
//       Order.countDocuments({ deleted: false }),
//       Order.aggregate([
//         { $match: { deleted: false, status: "delivered" } },
//         { $group: { _id: null, sum: { $sum: "$totalPrice" } } },
//       ]),

//       Order.find({ deleted: false })
//         .sort({ createdAt: -1 })
//         .limit(10)
//         .populate("userId", "fullName")
//         .lean(),
//       Category.find({ deleted: false, parent: "" })
//         .sort({ position: 1 })
//         .select({ _id: 1, name: 1 })
//         .lean(),
//       Product.find({ deleted: false })
//         .select({ name: 1, variants: 1 })
//         .lean(),

//       Order.find({
//         deleted: false,
//         payStatus: "paid",
//         status: { $ne: "cancelled" },
//       })
//         .select({ cart: 1, totalPrice: 1 })
//         .lean(),
//       Product.find({})
//         .select({ name: 1, variants: 1 })
//         .lean(),
//     ]);

//     const dashboard = {
//       order: orderCount,
//       priceTotal: revenueAgg?.[0]?.sum || 0,
//     };
//     const totalProduct = totalProductAgg?.[0]?.sum || 0;

//     const products = productsRaw || [];
//     let almostOver = 0;
//     let soldOut = 0;
//     let many = 0;

//     const computedTopProduct = products
//       .map((p) => {
//         const variants = p?.variants || [];

//         for (const v of variants) {
//           const q = Number(v?.quantity || 0);
//           if (q === 0) soldOut += 1;
//           else if (q <= thresholdAlmostOver) almostOver += 1;
//           else many += 1;
//         }

//         return { name: p?.name || "", sold: 0, profit: 0 };
//       })
//       .slice(0, 5);

//     const productMap = new Map(products.map((p) => [String(p?._id || ""), p]));
//     const allProductMap = new Map(
//       (allProductsRaw || []).map((p) => [String(p?._id || ""), p])
//     );

//     const topAccumulator = new Map();
//     for (const order of topOrdersRaw || []) {
//       const cart = order?.cart || [];
//       if (!cart.length) continue;

//       const lineTotals = cart.map(
//         (it) => (Number(it?.quantity || 0) * Number(it?.price || 0))
//       );
//       const sumLine = lineTotals.reduce((a, b) => a + b, 0);
//       const orderTotal = Number(order?.totalPrice || 0);

//       cart.forEach((it, idx) => {
//         const pid = String(it?.productId || "");
//         if (!pid) return;

//         const qty = Number(it?.quantity || 0);
//         const lineTotal = Number(lineTotals[idx] || 0);
//         const allocatedRevenue =
//           cart.length === 1
//             ? orderTotal
//             : sumLine > 0
//               ? (orderTotal * lineTotal) / sumLine
//               : lineTotal;

//         if (!topAccumulator.has(pid)) {
//           topAccumulator.set(pid, {
//             productId: pid,
//             sold: 0,
//             profit: 0,
//           });
//         }
//         const cur = topAccumulator.get(pid);
//         cur.sold += qty;
//         cur.profit += allocatedRevenue;
//       });
//     }

//     const topProduct = Array.from(topAccumulator.values())
//       .sort((a, b) => b.sold - a.sold || b.profit - a.profit)
//       .slice(0, 5)
//       .map((item) => ({
//         name: allProductMap.get(item.productId)?.name || "Không rõ",
//         sold: Number(item.sold || 0),
//         profit: Math.round(Number(item.profit || 0)),
//       }));

//     const topProductFinal = topProduct.length ? topProduct : computedTopProduct;

//     const formattedOrderNew = (orderNewRaw || []).map((order) => {
//       const m = moment(order.createdAt);
//       const orderCart = (order?.cart || []).map((it) => {
//         const product =
//           allProductMap.get(String(it?.productId || "")) ||
//           productMap.get(String(it?.productId || ""));
//         const variant = (product?.variants || []).find(
//           (v) => String(v?._id || "") === String(it?.variantId || "")
//         );
//         const variantImage = Array.isArray(variant?.images) && variant.images.length
//           ? variant.images[0]
//           : "";

//         return {
//           avatar: it?.image || it?.avatar || variantImage || "",
//           name: it?.name || product?.name || "",
//           quantity: it?.quantity || 0,
//           priceLast: it?.price || variant?.price || 0,
//         };
//       });

//       const statusKey = order?.status;
//       const mappedStatus = STATUS_MAP[statusKey] || "cancel";

//       const methodKey = order?.method;
//       const mappedMethod = METHOD_MAP[methodKey] || methodKey || "";

//       const payStatusKey = order?.payStatus;
//       const mappedPayStatus =
//         PAY_STATUS_MAP[payStatusKey] || payStatusKey || "";

//       return {
//         orderCode: order?.orderCode || "",
//         fullName: order?.userId?.fullName || "",
//         phone: order?.phone || "",
//         note: order?.address || "",
//         cart: orderCart,
//         priceTotal: order?.totalPrice || 0,
//         nameMethod: mappedMethod,
//         nameStatusPay: mappedPayStatus,
//         status: mappedStatus,
//         formatTime: m.isValid() ? m.format("HH:mm") : "",
//         formatDay: m.isValid() ? m.format("DD/MM/YYYY") : "",
//       };
//     });

//     const data = {
//       totalClient,
//       totalProduct,
//       dashboard,
//       categoryList: (categoryList || []).map((c) => ({
//         id: c._id,
//         name: c.name,
//       })),
//       almostOver,
//       soldOut,
//       many,
//       topProduct: topProductFinal,
//       orderNew: formattedOrderNew,
//     };

//     return res.status(200).json({ data });
//   } catch (error) {
//     return res.status(500).json({
//       message: "Lỗi khi lấy dashboard",
//       error: error.message,
//     });
//   }
// };

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

const EXCLUDE_APPROVED_RETURN_QUERY = {
  $or: [
    { returnRequest: { $exists: false } },
    { "returnRequest.status": { $in: [null, "", "none", "requested", "approved", "rejected"] } },
    { "returnRequest.revenueReversed": { $ne: true } },
  ],
};

// Hàm helper để tính toán khoảng thời gian dựa trên filterType
const getTimeBounds = (filterType, startQuery, endQuery) => {
  let start = moment().startOf("month");
  let end = moment().endOf("month");

  if (filterType === "range" && startQuery && endQuery) {
    start = moment(startQuery).startOf("day");
    end = moment(endQuery).endOf("day");
  } else if (filterType === "week") {
    // Tuần hiện tại
    start = moment().startOf("week");
    end = moment().endOf("week");
  } else if (filterType === "month") {
    // Tháng được chọn hoặc tháng hiện tại (Định dạng YYYY-MM)
    const targetMonth = startQuery ? moment(startQuery, "YYYY-MM") : moment();
    start = targetMonth.clone().startOf("month");
    end = targetMonth.clone().endOf("month");
  } else if (filterType === "year") {
    // Năm được chọn hoặc năm hiện tại (Định dạng YYYY)
    const targetYear = startQuery ? moment(startQuery, "YYYY") : moment();
    start = targetYear.clone().startOf("year");
    end = targetYear.clone().endOf("year");
  }

  return { startDate: start.toDate(), endDate: end.toDate() };
};

module.exports.getDashboard = async (req, res) => {
  try {
    const { filterType, startDate: sQ, endDate: eQ, productSearch } = req.query;
    const { startDate, endDate } = getTimeBounds(filterType, sQ, eQ);
    const thresholdAlmostOver = 5;

    const [totalClient, totalProductAgg, categoryList, productsRaw, allProductsRaw] =
      await Promise.all([
        AccountClient.countDocuments({ deleted: false }),
        Product.aggregate([
          { $match: { deleted: false } },
          { $unwind: { path: "$variants", preserveNullAndEmptyArrays: true } },
          { $group: { _id: null, sum: { $sum: { $ifNull: ["$variants.quantity", 0] } } } },
        ]),
        Category.find({ deleted: false, parent: "" })
          .sort({ position: 1 })
          .select({ _id: 1, name: 1 })
          .lean(),
        Product.find({ deleted: false }).select({ name: 1, variants: 1 }).lean(),
        Product.find({}).select({ name: 1, variants: 1 }).lean(),
      ]);

    let orderMatchQuery = {
      deleted: false,
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (productSearch && productSearch.trim() !== "") {
      const matchedProducts = await Product.find({
        name: { $regex: productSearch.trim(), $options: "i" },
        deleted: false,
      })
        .select({ _id: 1 })
        .lean();

      const matchedProductIds = matchedProducts.map((p) => String(p._id));

      orderMatchQuery["cart.productId"] = { $in: matchedProductIds };
    }
    const [orderCount, revenueAgg, orderNewRaw, topOrdersRaw] = await Promise.all([
      Order.countDocuments(orderMatchQuery),
      Order.aggregate([
        { $match: { ...orderMatchQuery, status: "delivered", ...EXCLUDE_APPROVED_RETURN_QUERY } },
        { $group: { _id: null, sum: { $sum: "$totalPrice" } } },
      ]),
      Order.find(orderMatchQuery)
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("userId", "fullName")
        .lean(),
      Order.find({
        deleted: false,
        payStatus: "paid",
        status: { $ne: "cancelled" },
        ...EXCLUDE_APPROVED_RETURN_QUERY,
        createdAt: { $gte: startDate, $lte: endDate },
      })
        .select({ cart: 1, totalPrice: 1 })
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

    products.forEach((p) => {
      const variants = p?.variants || [];
      for (const v of variants) {
        const q = Number(v?.quantity || 0);
        if (q === 0) soldOut += 1;
        else if (q <= thresholdAlmostOver) almostOver += 1;
        else many += 1;
      }
    });

    const allProductMap = new Map((allProductsRaw || []).map((p) => [String(p?._id || ""), p]));
    const productMap = new Map(products.map((p) => [String(p?._id || ""), p]));

    const topAccumulator = new Map();
    for (const order of topOrdersRaw || []) {
      const cart = order?.cart || [];
      if (!cart.length) continue;

      const lineTotals = cart.map((it) => Number(it?.quantity || 0) * Number(it?.price || 0));
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
          topAccumulator.set(pid, { productId: pid, sold: 0, profit: 0 });
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

    const formattedOrderNew = (orderNewRaw || []).map((order) => {
      const m = moment(order.createdAt);
      const orderCart = (order?.cart || []).map((it) => {
        const product =
          allProductMap.get(String(it?.productId || "")) ||
          productMap.get(String(it?.productId || ""));
        const variant = (product?.variants || []).find(
          (v) => String(v?._id || "") === String(it?.variantId || "")
        );
        return {
          avatar: it?.image || it?.avatar || variant?.images?.[0] || "",
          name: it?.name || product?.name || "",
          quantity: it?.quantity || 0,
          priceLast: it?.price || variant?.price || 0,
        };
      });

      return {
        orderCode: order?.orderCode || "",
        fullName: order?.userId?.fullName || "",
        phone: order?.phone || "",
        note: order?.address || "",
        cart: orderCart,
        priceTotal: order?.totalPrice || 0,
        nameMethod: METHOD_MAP[order?.method] || order?.method || "",
        nameStatusPay: PAY_STATUS_MAP[order?.payStatus] || order?.payStatus || "",
        status: STATUS_MAP[order?.status] || "cancel",
        formatTime: m.isValid() ? m.format("HH:mm") : "",
        formatDay: m.isValid() ? m.format("DD/MM/YYYY") : "",
      };
    });

    res.status(200).json({
      data: {
        totalClient,
        totalProduct,
        dashboard,
        almostOver,
        soldOut,
        many,
        categoryList: (categoryList || []).map((c) => ({ id: c._id, name: c.name })),
        topProduct,
        orderNew: formattedOrderNew,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Lỗi khi lấy dashboard", error: error.message });
  }
};

module.exports.revenueChart = async (req, res) => {
  try {
    const { filterType, startDate: sQ, endDate: eQ } = req.body || {};

    // Tận dụng logic lấy khoảng thời gian
    let { startDate, endDate } = getTimeBounds(filterType, sQ, eQ);

    const startCurrent = moment(startDate);
    const endCurrent = moment(endDate);

    // Tính toán mốc thời gian đối sánh của kỳ trước (Phục vụ vẽ 2 đường biểu đồ)
    let startPrevious, endPrevious;
    let labelCurrent = "Kỳ này";
    let labelPrevious = "Kỳ trước";

    if (filterType === "month") {
      startPrevious = startCurrent.clone().subtract(1, "month").startOf("month");
      endPrevious = startCurrent.clone().subtract(1, "month").endOf("month");
      labelCurrent = `Tháng ${startCurrent.format("MM/YYYY")}`;
      labelPrevious = `Tháng ${startPrevious.format("MM/YYYY")}`;
    } else if (filterType === "year") {
      startPrevious = startCurrent.clone().subtract(1, "year").startOf("year");
      endPrevious = startCurrent.clone().subtract(1, "year").endOf("year");
      labelCurrent = `Năm ${startCurrent.format("YYYY")}`;
      labelPrevious = `Năm ${startPrevious.format("YYYY")}`;
    } else if (filterType === "week") {
      startPrevious = startCurrent.clone().subtract(1, "week").startOf("week");
      endPrevious = startCurrent.clone().subtract(1, "week").endOf("week");
      labelCurrent = "Tuần này";
      labelPrevious = "Tuần trước";
    } else {
      // Trường hợp chọn khoảng ngày (range) -> lấy số ngày tương ứng lùi về quá khứ
      const diffDays = endCurrent.diff(startCurrent, "days") + 1;
      startPrevious = startCurrent.clone().subtract(diffDays, "days");
      endPrevious = startCurrent.clone().subtract(1, "days");
    }

    const [orderCurrent, orderPrevious] = await Promise.all([
      Order.find({
        deleted: false,
        payStatus: "paid",
        ...EXCLUDE_APPROVED_RETURN_QUERY,
        createdAt: { $gte: startCurrent.toDate(), $lte: endCurrent.toDate() },
      }).lean(),
      Order.find({
        deleted: false,
        payStatus: "paid",
        ...EXCLUDE_APPROVED_RETURN_QUERY,
        createdAt: { $gte: startPrevious.toDate(), $lte: endPrevious.toDate() },
      }).lean(),
    ]);

    let labels = [];
    let dataMonthCurrent = [];
    let dataMonthPrevious = [];

    // Tạo Trục X linh hoạt dựa vào FilterType
    if (filterType === "year") {
      // Lọc theo 12 tháng
      for (let m = 1; m <= 12; m++) {
        labels.push(`Tháng ${m}`);

        let sumCur = orderCurrent
          .filter((o) => moment(o.createdAt).month() + 1 === m)
          .reduce((a, b) => a + (b.totalPrice || 0), 0);
        let sumPrev = orderPrevious
          .filter((o) => moment(o.createdAt).month() + 1 === m)
          .reduce((a, b) => a + (b.totalPrice || 0), 0);

        dataMonthCurrent.push(sumCur);
        dataMonthPrevious.push(sumPrev);
      }
    } else {
      // Lọc theo từng ngày (Dùng cho Tuần, Tháng, và Khoảng ngày)
      let daysCount =
        filterType === "month"
          ? startCurrent.daysInMonth()
          : endCurrent.diff(startCurrent, "days") + 1;
      if (filterType === "range" && daysCount > 62) daysCount = 31; // Giới hạn nếu khoảng ngày quá rộng tránh crash UI

      for (let i = 0; i < daysCount; i++) {
        const curDayStr = startCurrent.clone().add(i, "days").format("DD/MM");
        labels.push(curDayStr);

        const currentTargetDate = startCurrent.clone().add(i, "days");
        const previousTargetDate = startPrevious.clone().add(i, "days");

        let sumCur = orderCurrent
          .filter((o) => moment(o.createdAt).isSame(currentTargetDate, "day"))
          .reduce((a, b) => a + (b.totalPrice || 0), 0);
        let sumPrev = orderPrevious
          .filter((o) => moment(o.createdAt).isSame(previousTargetDate, "day"))
          .reduce((a, b) => a + (b.totalPrice || 0), 0);

        dataMonthCurrent.push(sumCur);
        dataMonthPrevious.push(sumPrev);
      }
    }

    return res.status(200).json({
      code: "success",
      labels,
      labelCurrent,
      labelPrevious,
      dataMonthCurrent,
      dataMonthPrevious,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ code: "error", message: "Lỗi biểu đồ doanh thu", error: error.message });
  }
};

// module.exports.revenueChart = async (req, res) => {
//   try {
//     const { currentMonth, currentYear, previousMonth, previousYear, arrayDay } = req.body || {};

//     const safeArrayDay = Array.isArray(arrayDay) ? arrayDay.map((d) => Number(d)) : [];
//     if (!currentMonth || !currentYear || !previousMonth || !previousYear || !safeArrayDay.length) {
//       return res.status(400).json({ code: "error", message: "Thiếu dữ liệu biểu đồ doanh thu" });
//     }

//     const startCurrent = new Date(Number(currentYear), Number(currentMonth) - 1, 1);
//     const endCurrent = new Date(Number(currentYear), Number(currentMonth), 1);
//     const startPrevious = new Date(Number(previousYear), Number(previousMonth) - 1, 1);
//     const endPrevious = new Date(Number(previousYear), Number(previousMonth), 1);

//     const [orderCurrent, orderPrevious] = await Promise.all([
//       Order.find({
//         deleted: false,
//         payStatus: "paid",
//         createdAt: { $gte: startCurrent, $lt: endCurrent },
//       }).lean(),
//       Order.find({
//         deleted: false,
//         payStatus: "paid",
//         createdAt: { $gte: startPrevious, $lt: endPrevious },
//       }).lean(),
//     ]);

//     const dataMonthCurrent = [];
//     const dataMonthPrevious = [];

//     for (const day of safeArrayDay) {
//       let total = 0;
//       for (const item of orderCurrent) {
//         const orderDate = new Date(item.createdAt).getDate();
//         if (day === orderDate) total += item.totalPrice || 0;
//       }
//       dataMonthCurrent.push(total);
//     }

//     for (const day of safeArrayDay) {
//       let total = 0;
//       for (const item of orderPrevious) {
//         const orderDate = new Date(item.createdAt).getDate();
//         if (day === orderDate) total += item.totalPrice || 0;
//       }
//       dataMonthPrevious.push(total);
//     }

//     return res.status(200).json({
//       code: "success",
//       dataMonthCurrent,
//       dataMonthPrevious,
//     });
//   } catch (error) {
//     return res.status(500).json({
//       code: "error",
//       message: "Lỗi khi lấy biểu đồ doanh thu",
//       error: error.message,
//     });
//   }
// };

module.exports.revenueChart = async (req, res) => {
  try {
    const { filterType, startDate: sQ, endDate: eQ } = req.body || {};

    // Lấy mốc thời gian của kỳ này
    let { startDate, endDate } = getTimeBounds(filterType, sQ, eQ);

    const startCurrent = moment(startDate);
    const endCurrent = moment(endDate);

    let labelCurrent = "Doanh thu";

    if (filterType === "month") {
      labelCurrent = `Tháng ${startCurrent.format("MM/YYYY")}`;
    } else if (filterType === "year") {
      labelCurrent = `Năm ${startCurrent.format("YYYY")}`;
    } else if (filterType === "week") {
      labelCurrent = "Tuần này";
    }

    // Chỉ truy vấn hóa đơn thuộc kỳ hiện tại
    const orderCurrent = await Order.find({
      deleted: false,
      payStatus: "paid",
      ...EXCLUDE_APPROVED_RETURN_QUERY,
      createdAt: { $gte: startCurrent.toDate(), $lte: endCurrent.toDate() },
    }).lean();

    let labels = [];
    let dataMonthCurrent = [];

    if (filterType === "year") {
      // Thống kê theo 12 tháng
      for (let m = 1; m <= 12; m++) {
        labels.push(`Tháng ${m}`);

        let sumCur = orderCurrent
          .filter((o) => moment(o.createdAt).month() + 1 === m)
          .reduce((a, b) => a + (b.totalPrice || 0), 0);

        dataMonthCurrent.push(sumCur);
      }
    } else {
      // Thống kê theo từng ngày (Cho Tuần, Tháng, Khoảng ngày)
      let daysCount =
        filterType === "month"
          ? startCurrent.daysInMonth()
          : endCurrent.diff(startCurrent, "days") + 1;
      if (filterType === "range" && daysCount > 31) daysCount = 31;

      for (let i = 0; i < daysCount; i++) {
        const currentTargetDate = startCurrent.clone().add(i, "days");

        labels.push(currentTargetDate.format("DD/MM"));

        let sumCur = orderCurrent
          .filter(
            (o) =>
              moment(o.createdAt).format("YYYY-MM-DD") === currentTargetDate.format("YYYY-MM-DD")
          )
          .reduce((a, b) => a + (b.totalPrice || 0), 0);

        dataMonthCurrent.push(sumCur);
      }
    }

    return res.status(200).json({
      code: "success",
      labels,
      labelCurrent,
      dataMonthCurrent,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ code: "error", message: "Lỗi biểu đồ doanh thu", error: error.message });
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
