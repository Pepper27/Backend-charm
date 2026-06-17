const Order = require("../../models/order.model");
const {
  extractEmail,
  extractOrderCode,
  extractPhone,
  asArray,
  asText,
  formatPrice,
} = require("./shared");
const { isGlobalChatScope } = require("./context.service");

const orderStatusLabelVI = (status) => {
  const value = String(status || "");
  if (value === "pending") return "Chờ xác nhận";
  if (value === "confirmed") return "Chờ lấy hàng";
  if (value === "shipping") return "Đang giao";
  if (value === "delivered") return "Đã giao";
  if (value === "cancelled") return "Đã huỷ";
  return value || "đang xử lý";
};

const paymentMethodLabelVI = (method) => {
  const value = String(method || "").toLowerCase();
  if (value === "zalopay") return "ZaloPay";
  if (value === "cash") return "COD (thanh toán khi nhận hàng)";
  return value || "chưa rõ";
};

const summarizeOrderFromDb = (order) => {
  if (!order) return null;
  const items = [];
  for (const line of asArray(order.cart).slice(0, 8)) {
    items.push({
      name: asText(line?.name, 120),
      quantity: Math.max(1, Number(line?.quantity) || 1),
      priceText: formatPrice(line?.price, line?.price),
    });
  }
  for (const bundle of asArray(order.bundles).slice(0, 4)) {
    items.push({
      name: asText(bundle?.name || "Thiết kế mix charm", 120),
      quantity: Math.max(1, Number(bundle?.quantity) || 1),
      priceText: formatPrice(bundle?.priceSnapshot?.total, bundle?.priceSnapshot?.total),
    });
  }
  return {
    orderCode: asText(order.orderCode, 40),
    status: orderStatusLabelVI(order.status),
    paymentStatus: order.payStatus === "paid" ? "Đã thanh toán" : "Chưa thanh toán",
    method: paymentMethodLabelVI(order.method),
    totalText: formatPrice(order.totalPrice, order.totalPrice),
    canCancel: ["pending", "confirmed"].includes(String(order.status || "")),
    items,
    notFound: false,
  };
};

const lookupOrderForChat = async ({ message, context }) => {
  if (!isGlobalChatScope(context) && context?.order?.orderCode) {
    return context.order;
  }

  const orderCode = extractOrderCode(message);
  if (orderCode) {
    const order = await Order.findOne({ orderCode, deleted: false })
      .select("orderCode status method payStatus totalPrice cart bundles createdAt")
      .lean();
    if (!order) return { orderCode, notFound: true };
    return summarizeOrderFromDb(order);
  }

  const email = extractEmail(message);
  const phone = extractPhone(message);
  if (!email && !phone) return null;

  const find = { deleted: false };
  if (email && phone) find.$or = [{ email }, { phone }];
  else if (email) find.email = email;
  else find.phone = phone;

  const orders = await Order.find(find)
    .sort({ createdAt: -1 })
    .select("orderCode status method payStatus totalPrice cart bundles createdAt")
    .limit(3)
    .lean();

  if (!orders.length) return { lookupKey: email || phone, notFound: true };
  if (orders.length === 1) return summarizeOrderFromDb(orders[0]);

  return {
    multiple: true,
    lookupKey: email || phone,
    orders: orders.map((order) => summarizeOrderFromDb(order)),
  };
};

module.exports = {
  lookupOrderForChat,
  summarizeOrderFromDb,
};
