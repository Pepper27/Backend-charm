const mongoose = require("mongoose");
const Order = require("../../models/order.model");
const Product = require("../../models/product.model");

const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizePhone = (value) => String(value || "").trim();

const normalizeImages = (images) =>
  (Array.isArray(images) ? images : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 3);

const buildError = (status, code, message, meta = null) => ({
  status,
  code,
  message,
  meta,
});

const ensureReturnRequestAllowed = (order) => {
  if (!order) throw buildError(404, "ORDER_NOT_FOUND", "Đơn hàng không tồn tại");
  if (order.deleted) throw buildError(404, "ORDER_NOT_FOUND", "Đơn hàng không tồn tại");
  if (String(order.status) !== "delivered") {
    throw buildError(
      409,
      "ORDER_NOT_DELIVERED",
      "Chỉ có thể yêu cầu hoàn hàng sau khi đơn đã giao"
    );
  }

  const returnStatus = String(order?.returnRequest?.status || "none");
  if (["requested", "approved", "completed"].includes(returnStatus)) {
    throw buildError(
      409,
      "RETURN_REQUEST_EXISTS",
      returnStatus === "completed"
        ? "Đơn hàng này đã hoàn hàng thành công"
        : returnStatus === "approved"
          ? "Đơn hàng này đã được duyệt hoàn hàng và đang chờ shop nhận lại hàng"
          : "Đơn hàng này đang có yêu cầu hoàn hàng chờ xử lý"
    );
  }
};

const ensureCustomerCanAccessOrder = ({ order, clientId, guestId, email, phone }) => {
  const orderUserId = String(order?.userId || "");
  const orderGuestId = String(order?.guestId || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);

  if (clientId && orderUserId && String(clientId) === orderUserId) return;
  if (guestId && orderGuestId && String(guestId).trim() === orderGuestId) return;

  const orderEmail = normalizeEmail(order?.email);
  const orderPhone = normalizePhone(order?.phone);
  if (
    normalizedEmail &&
    normalizedPhone &&
    normalizedEmail === orderEmail &&
    normalizedPhone === orderPhone
  ) {
    return;
  }

  throw buildError(403, "FORBIDDEN", "Bạn không có quyền gửi yêu cầu hoàn hàng cho đơn này");
};

const createReturnRequest = async ({
  orderCode,
  reason,
  images,
  clientId,
  guestId,
  email,
  phone,
}) => {
  const safeOrderCode = String(orderCode || "").trim();
  if (!safeOrderCode) {
    throw buildError(400, "BAD_REQUEST", "Thiếu orderCode");
  }

  const safeReason = String(reason || "").trim();
  if (!safeReason) {
    throw buildError(400, "BAD_REQUEST", "Lý do hoàn hàng là bắt buộc");
  }

  const safeImages = normalizeImages(images);
  if (!safeImages.length) {
    throw buildError(400, "BAD_REQUEST", "Yêu cầu hoàn hàng phải có ít nhất 1 ảnh minh hoạ");
  }
  if (safeImages.length > 3) {
    throw buildError(400, "BAD_REQUEST", "Chỉ được gửi tối đa 3 ảnh minh hoạ");
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const order = await Order.findOne({ orderCode: safeOrderCode, deleted: false }).session(
      session
    );
    ensureReturnRequestAllowed(order);
    ensureCustomerCanAccessOrder({ order, clientId, guestId, email, phone });

    order.returnRequest = {
      ...(order.returnRequest?.toObject
        ? order.returnRequest.toObject()
        : order.returnRequest || {}),
      status: "requested",
      reason: safeReason,
      images: safeImages,
      requestedAt: new Date(),
      requestedBy: "customer",
      reviewedAt: null,
      reviewedBy: "",
      adminNote: "",
      restocked: false,
      soldReversed: false,
      revenueReversed: false,
    };
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: "return_requested",
      changedAt: new Date(),
      changedBy: clientId ? String(clientId) : "customer",
      note: safeReason,
    });

    await order.save({ session });
    await session.commitTransaction();
    return await Order.findById(order._id).lean();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const reviewReturnRequest = async ({ orderId, action, adminId, adminNote }) => {
  if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
    throw buildError(400, "BAD_REQUEST", "Id đơn hàng không hợp lệ");
  }

  const normalizedAction = String(action || "")
    .trim()
    .toLowerCase();
  if (!["approve", "reject", "complete"].includes(normalizedAction)) {
    throw buildError(400, "BAD_REQUEST", "action phải là approve, reject hoặc complete");
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const order = await Order.findById(orderId).session(session);
    if (!order || order.deleted) {
      throw buildError(404, "ORDER_NOT_FOUND", "Đơn hàng không tồn tại");
    }

    const returnStatus = String(order?.returnRequest?.status || "none");
    order.returnRequest.reviewedAt = new Date();
    order.returnRequest.reviewedBy = String(adminId || "").trim();
    order.returnRequest.adminNote = String(adminNote || "").trim();

    if (normalizedAction === "reject") {
      if (returnStatus !== "requested") {
        throw buildError(
          409,
          "RETURN_REQUEST_INVALID",
          "Chỉ có thể từ chối yêu cầu hoàn hàng đang chờ duyệt"
        );
      }
      order.returnRequest.status = "rejected";
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: "return_rejected",
        changedAt: new Date(),
        changedBy: String(adminId || "admin"),
        note: order.returnRequest.adminNote,
      });

      await order.save({ session });
      await session.commitTransaction();
      return await Order.findById(order._id).lean();
    }

    if (normalizedAction === "approve") {
      if (returnStatus !== "requested") {
        throw buildError(
          409,
          "RETURN_REQUEST_INVALID",
          "Chỉ có thể duyệt yêu cầu hoàn hàng đang chờ xử lý"
        );
      }

      order.returnRequest.status = "approved";
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: "return_approved",
        changedAt: new Date(),
        changedBy: String(adminId || "admin"),
        note: order.returnRequest.adminNote,
      });

      await order.save({ session });
      await session.commitTransaction();
      return await Order.findById(order._id).lean();
    }

    if (returnStatus !== "approved") {
      throw buildError(
        409,
        "RETURN_REQUEST_INVALID",
        "Chỉ có thể hoàn tất khi yêu cầu hoàn hàng đã được duyệt"
      );
    }

    if (!order.returnRequest.restocked) {
      for (const item of order.cart || []) {
        await Product.updateOne(
          { "variants._id": item.variantId },
          { $inc: { "variants.$.quantity": Number(item.quantity) || 0 } },
          { session }
        );
      }
      order.returnRequest.restocked = true;
    }

    if (!order.returnRequest.soldReversed) {
      for (const item of order.cart || []) {
        await Product.updateOne(
          { "variants._id": item.variantId },
          { $inc: { "variants.$.sold": -(Number(item.quantity) || 0) } },
          { session }
        );
      }
      order.returnRequest.soldReversed = true;
    }

    order.returnRequest.status = "completed";
    order.returnRequest.revenueReversed = true;
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: "return_completed",
      changedAt: new Date(),
      changedBy: String(adminId || "admin"),
      note: order.returnRequest.adminNote,
    });

    await order.save({ session });
    await session.commitTransaction();
    return await Order.findById(order._id).lean();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = {
  createReturnRequest,
  reviewReturnRequest,
  buildError,
};
