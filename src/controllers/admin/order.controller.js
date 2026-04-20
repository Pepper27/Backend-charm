const Order = require("../../models/order.model");
const Product = require("../../models/product.model");
const mongoose = require("mongoose");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    if (payStatus) find.payStatus = payStatus;

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
      find.$or = [
        { orderCode: rx },
        { phone: rx },
        { email: rx },
        { fullName: rx },
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
        "orderCode userId cart bundles fullName email totalPrice status method payStatus address phone createdAt updatedAt"
      )
      .populate({ path: "userId", select: "fullName email phone" })
      .lean();

    const withCounts = (orders || []).map((o) => ({
      ...o,
      itemsCount: (o.cart || []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0),
    }));

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
    req.body.updatedBy = req.account.id;
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
