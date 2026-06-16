const Order = require("../../models/order.model");
const Product = require("../../models/product.model");
const mongoose = require("mongoose");
const slugify = require("slugify");
const ExcelJS = require("exceljs");
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const inferPayStatus = (o) => {
  try {
    if (!o) return "unpaid";
    // If explicitly marked paid in DB, respect it.
    if (o.payStatus === "paid") return "paid";
    // Consider captured amount or provider transaction id as proof of payment.
    const captured = Number((o.payment && o.payment.capturedAmount) || 0);
    const zpTransId = String((o.payment && o.payment.zpTransId) || "").trim();
    if (captured > 0 || zpTransId) return "paid";
    return "unpaid";
  } catch (e) {
    return "unpaid";
  }
};

const buildPayStatusFind = (payStatus) => {
  const v = String(payStatus || "").trim().toLowerCase();
  if (!v) return null;

  const paidOr = [
    { payStatus: "paid" },
    { "payment.capturedAmount": { $gt: 0 } },
    { "payment.zpTransId": { $exists: true, $ne: "" } },
  ];

  if (v === "paid") return { $or: paidOr };
  if (v === "unpaid") return { $nor: paidOr };
  return null;
};

module.exports.getOrders = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const parsedLimit = Number.parseInt(req.query.limit, 10) || 10;
    const limit = Math.min(Math.max(parsedLimit, 1), 50);

    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim();
    const method = String(req.query.method || "").trim();
    const payStatus = String(req.query.payStatus || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    const find = { deleted: false };

    if (status) find.status = status;
    if (method) find.method = method;
    const payFind = buildPayStatusFind(payStatus);
    if (payFind) Object.assign(find, payFind);

    if (startDate || endDate) {
      const createdAtFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        if (Number.isNaN(start.getTime())) {
          return res.status(400).json({ message: "startDate không hợp lệ" });
        }
        start.setHours(0, 0, 0, 0);
        createdAtFilter.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (Number.isNaN(end.getTime())) {
          return res.status(400).json({ message: "endDate không hợp lệ" });
        }
        end.setHours(23, 59, 59, 999);
        createdAtFilter.$lte = end;
      }
      if (
        createdAtFilter.$gte &&
        createdAtFilter.$lte &&
        createdAtFilter.$gte > createdAtFilter.$lte
      ) {
        return res.status(400).json({ message: "startDate không được lớn hơn endDate" });
      }
      find.createdAt = createdAtFilter;
    }

    if (keyword) {
      const rx = new RegExp(escapeRegex(keyword), "i");
      const keywordSlug = slugify(keyword, { lower: true, strict: true, locale: "vi" });
      const sl = new RegExp(keywordSlug.replace(/-/g, ".*"), "i"); 
      find.$or = [
        { orderCode: rx },
        { phone: rx },
        { email: rx },
        { slug: sl },
        { address: rx },
      ];
    }

    const total = await Order.countDocuments(find);
    const totalPage = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPage);
    const skip = (safePage - 1) * limit;

    const orders = await Order.find(find)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "orderCode userId cart bundles fullName email totalPrice status method payStatus address phone payment createdAt updatedAt"
      )
      .populate({ path: "userId", select: "fullName email phone" })
      .lean();

    const withCounts = (orders || []).map((o) => {
      const base = {
        ...o,
        itemsCount: (o.cart || []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0),
      };
      // ensure payStatus is friendly for admin UI — always infer from available
      // fields so admin sees correct payment state even for legacy rows.
      base.payStatus = inferPayStatus(base);
      return base;
    });

    return res.status(200).json({
      data: withCounts,
      total,
      currentPage: safePage,
      totalPage,
      limit,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Lỗi khi lấy danh sách đơn hàng", error: error.message });
  }
};

module.exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }
    const order = await Order.findOne({ _id: id, deleted: false })
      .populate({ path: "userId", select: "fullName email phone" })
      .lean();
    if (!order) {
      return res.status(404).json({ message: "Đơn hàng không tồn tại" });
    }
    // ensure payStatus is present for UI convenience
    order.payStatus = order.payStatus === "paid" ? "paid" : inferPayStatus(order);
    return res.status(200).json({ data: order });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi khi lấy chi tiết đơn hàng", error: error.message });
  }
};

module.exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Đơn hàng không tồn tại" });
    }

     // Business rule: cash orders are paid upon successful delivery.
     // If admin marks as delivered, automatically mark payStatus as paid.
     if (
       String(req.body?.status) === "delivered" &&
       String(order.method || "").toLowerCase() === "cash"
     ) {
       req.body.payStatus = "paid";
     }

    req.body.updatedBy = req.account.id;
    // Business rule: cancelled is terminal. Do not allow admin to change a cancelled order
    // back to any other lifecycle state to avoid stock/refund conflicts. If admin wants
    // to "restore", they should create a new order instead.
    if (String(order.status) === "cancelled" && req.body.status && String(req.body.status) !== "cancelled") {
      const latest = await Order.findById(id).lean();
      return res.status(409).json({ message: "Cancelled orders are terminal and cannot be reverted. Create a new order to restore.", data: latest });
    }
    await Order.updateOne(
      {
        _id: id,
      },
      req.body
    );

    if (req.body.status === "delivered" && order.checkStatus === false) {
      for (const item of order.cart) {
        await Product.updateOne(
          {
            "variants._id": item.variantId,
          },
          {
            $inc: {
              "variants.$.sold": +item.quantity,
            },
          }
        );
      }
      await Order.updateOne(
        { _id: id },
        {
          checkStatus: true,
        }
      );
    }
    const updated = await Order.findById(id)
      .populate({ path: "userId", select: "fullName email phone" })
      .lean();

    return res.status(200).json({
      message: "Cập nhật đơn hàng thành công",
      data: updated || order,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi khi cập nhật đơn hàng",
      error: error.message,
    });
  }
};

module.exports.exportOrders = async (req, res) => {
  try {
    const keyword = String(req.query.keyword || "").trim();
    const status = String(req.query.status || "").trim();
    const method = String(req.query.method || "").trim();
    const payStatus = String(req.query.payStatus || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    const find = { deleted: false };

    if (status) find.status = status;
    if (method) find.method = method;
    const payFind = buildPayStatusFind(payStatus);
    if (payFind) Object.assign(find, payFind);

    if (startDate || endDate) {
      const createdAtFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          createdAtFilter.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          createdAtFilter.$lte = end;
        }
      }
      if (createdAtFilter.$gte && createdAtFilter.$lte && createdAtFilter.$gte > createdAtFilter.$lte) {
        return res.status(400).json({ message: "startDate không được lớn hơn endDate" });
      }
      find.createdAt = createdAtFilter;
    }

    if (keyword) {
      const rx = new RegExp(escapeRegex(keyword), "i");
      const keywordSlug = slugify(keyword, { lower: true, strict: true, locale: "vi" });
      const sl = new RegExp(keywordSlug.replace(/-/g, ".*"), "i"); 
      find.$or = [
        { orderCode: rx },
        { phone: rx },
        { email: rx },
        { slug: sl },
        { address: rx },
      ];
    }
    const orders = await Order.find(find)
      .sort({ createdAt: -1 })
      .populate({ path: "userId", select: "fullName email phone" })
      .lean();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Danh sách Đơn hàng");

    worksheet.columns = [
      { header: "Mã Đơn Hàng", key: "orderCode", width: 20 },
      { header: "Khách Hàng", key: "customerName", width: 25 },
      { header: "Email", key: "email", width: 25 },
      { header: "Số Điện Thoại", key: "phone", width: 15 },
      { header: "Địa Chỉ giao hàng", key: "address", width: 35 },
      { header: "Số Lượng SP", key: "itemsCount", width: 12 },
      { header: "Tổng Tiền", key: "totalPrice", width: 18 },
      { header: "Trạng Thái đơn", key: "status", width: 18 },
      { header: "Trạng Thái Thanh Toán", key: "payStatus", width: 18 },
      { header: "Phương Thức Thanh Toán", key: "method", width: 15 },
      { header: "Ngày Đặt", key: "createdAt", width: 22 },
    ];

    const STATUS_MAP = { pending: "Chờ xác nhận", confirmed: "Đang chuẩn bị", shipping: "Đang giao", delivered: "Đã giao", cancelled: "Đã hủy" };
    const METHOD_MAP = { cash: "Tiền mặt", zalopay: "ZaloPay" };
    const PAY_MAP = { unpaid: "Chưa thanh toán", paid: "Đã thanh toán" };

    orders.forEach((o) => {
      const itemsCount = (o.cart || []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
      const inferredPay = inferPayStatus(o);

      worksheet.addRow({
        orderCode: o.orderCode || o._id.toString(),
        customerName: o?.userId?.fullName || o?.fullName || "Chưa có",
        email: o?.userId?.email || o?.email || "",
        phone: o?.userId?.phone || o?.phone || "",
        address: o.address || "",
        itemsCount: itemsCount,
        totalPrice: Number(o.totalPrice) || 0,
        status: STATUS_MAP[o.status] || o.status,
        payStatus: PAY_MAP[inferredPay] || inferredPay,
        method: METHOD_MAP[o.method] || o.method,
        createdAt: o.createdAt ? new Date(o.createdAt).toLocaleString("vi-VN") : "",
      });
    });

    const headerRow = worksheet.getRow(1);
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "4F81BD" } }; 
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.height = 20;
        row.getCell("totalPrice").numberFormat = '#,##0"₫"';
        row.getCell("totalPrice").alignment = { horizontal: "right" };
        row.getCell("itemsCount").alignment = { horizontal: "center" };
        row.getCell("orderCode").alignment = { horizontal: "center" };
        row.getCell("phone").alignment = { horizontal: "center" };
        
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "E0E0E0" } },
            left: { style: "thin", color: { argb: "E0E0E0" } },
            bottom: { style: "thin", color: { argb: "E0E0E0" } },
            right: { style: "thin", color: { argb: "E0E0E0" } },
          };
        });
      }
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Danh_sach_don_hang_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    return res.end();

  } catch (error) {
    console.error("Export excel error: ", error);
    return res.status(500).json({ message: "Lỗi khi xuất file excel", error: error.message });
  }
};