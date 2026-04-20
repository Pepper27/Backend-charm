const mongoose = require("mongoose");

const Cart = require("../../models/cart.model");
const Order = require("../../models/order.model");
const Product = require("../../models/product.model");
const { ensureGuestIdCookie } = require("../../helper/guest.helper");
const { validateAndPrice } = require("../../helper/mix-validate.helper");
const helper = require("../../helper/generate.helper");
const mailHelper = require("../../helper/mailer.helper");

const normalizePhone = (value) => String(value || "").trim();
const normalizeName = (value) => String(value || "").trim();
const normalizeAddress = (value) => String(value || "").trim();
const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const statusLabelVI = (s) => {
  const v = String(s || "");
  if (v === "pending") return "Chờ xác nhận";
  if (v === "confirmed") return "Chờ lấy hàng";
  if (v === "shipping") return "Đang giao";
  if (v === "delivered") return "Đã giao";
  if (v === "cancelled") return "Đã huỷ";
  return v || "-";
};

const findVariantByCode = (product, code) => {
  const safe = String(code || "");
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.find((v) => String(v?.code) === safe) || null;
};

const imageForVariant = (variant) => {
  const img = variant?.images?.[0];
  return typeof img === "string" && img.trim() ? img.trim() : "";
};

const buildOrderComponentLineItems = async ({ bundle, pricingResult }) => {
  // pricingResult is from validateAndPrice, and is the canonical snapshot.
  const braceletSnapshot = pricingResult.braceletSnapshot;
  const itemsSnapshot = pricingResult.itemsSnapshot;

  const braceletProduct = await Product.findOne({
    _id: braceletSnapshot.productId,
    deleted: false,
  }).lean();
  if (!braceletProduct) throw new Error("Bracelet product not found");
  const braceletVariant = findVariantByCode(braceletProduct, braceletSnapshot.variantCode);
  if (!braceletVariant) throw new Error("Bracelet variant not found");

  const charmIds = [...new Set((itemsSnapshot || []).map((it) => String(it.charmProductId)))];
  const charmProducts = await Product.find({ _id: { $in: charmIds }, deleted: false }).lean();
  const charmById = new Map((charmProducts || []).map((p) => [String(p._id), p]));

  const quantityMultiplier = Number(bundle?.quantity) || 1;
  const lines = [];

  // Bracelet component (1 per bundle).
  lines.push({
    productId: String(braceletProduct._id),
    variantId: String(braceletVariant._id),
    price: Number(braceletVariant.price) || 0,
    quantity: 1 * quantityMultiplier,
    name: String(braceletProduct.name || ""),
    image: imageForVariant(braceletVariant),
  });

  // Charm components.
  for (const it of itemsSnapshot || []) {
    const charm = charmById.get(String(it.charmProductId));
    if (!charm) throw new Error("Charm product not found");
    const charmVariant = findVariantByCode(charm, it.charmVariantCode);
    if (!charmVariant) throw new Error("Charm variant not found");
    lines.push({
      productId: String(charm._id),
      variantId: String(charmVariant._id),
      price: Number(charmVariant.price) || 0,
      quantity: 1 * quantityMultiplier,
      name: String(charm.name || ""),
      image: imageForVariant(charmVariant),
    });
  }

  return lines;
};

module.exports.checkoutBundles = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const body = req.body || {};
    const bundleIds = Array.isArray(body.bundleIds) ? body.bundleIds.map(String) : [];

    const phone = normalizePhone(body.phone);
    const fullName = normalizeName(body.fullName);
    const address = normalizeAddress(body.address);
    const email = normalizeEmail(body.email);

    const method = String(body.method || "cash").trim();
    if (!phone || !fullName || !address) {
      return res.status(400).json({ message: "Thiếu thông tin: phone, fullName, address" });
    }
    if (!bundleIds.length) {
      return res.status(400).json({ message: "Thiếu bundleIds" });
    }
    if (method !== "cash" && method !== "zalopay") {
      return res.status(400).json({ message: "Phương thức thanh toán không hợp lệ" });
    }

    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };
    const cart = await Cart.findOne(cartKey).lean();
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const allBundles = Array.isArray(cart.bundles) ? cart.bundles : [];
    const selectedBundles = allBundles.filter((b) => bundleIds.includes(String(b.bundleId)));
    if (!selectedBundles.length) {
      return res.status(400).json({ message: "Không tìm thấy bundle trong giỏ" });
    }

    // Re-validate and compute canonical snapshots.
    const validated = [];
    for (const b of selectedBundles) {
      const result = await validateAndPrice({ bracelet: b.bracelet, items: b.items });
      if (!result.valid) {
        return res.status(400).json({
          message: "Design không hợp lệ hoặc hết hàng",
          bundleId: b.bundleId,
          errors: result.errors,
        });
      }
      validated.push({ bundle: b, result });
    }

    // Build flattened component lines and aggregate required quantities per variantId.
    const allLines = [];
    const requiredByVariantId = new Map();
    for (const { bundle, result } of validated) {
      const lines = await buildOrderComponentLineItems({ bundle, pricingResult: result });
      for (const line of lines) {
        allLines.push(line);
        const variantId = String(line.variantId);
        requiredByVariantId.set(
          variantId,
          (requiredByVariantId.get(variantId) || 0) + (Number(line.quantity) || 0)
        );
      }
    }

    // Stock checks against aggregated demand.
    const productUpdates = [];
    for (const [variantId, requiredQuantity] of requiredByVariantId.entries()) {
      const product = await Product.findOne({ "variants._id": variantId });
      if (!product) {
        return res
          .status(400)
          .json({ message: `Không tìm thấy sản phẩm chứa variantId ${variantId}` });
      }
      const variant = product.variants.id(variantId);
      if (!variant) {
        return res.status(400).json({ message: `Variant không tồn tại: ${variantId}` });
      }
      if (variant.quantity < requiredQuantity) {
        return res.status(400).json({
          message: `Sản phẩm ${variant.code || variantId} chỉ còn ${variant.quantity} trong kho`,
        });
      }
      variant.quantity -= requiredQuantity;
      productUpdates.push(product);
    }

    // Save stock updates.
    for (const product of productUpdates) {
      await product.save();
    }

    const orderCode = `ORD${Date.now()}${helper.generateRandomNumber(4)}`;
    const totalPrice = validated.reduce(
      (sum, { bundle, result }) =>
        sum + (Number(result?.pricing?.total) || 0) * (Number(bundle?.quantity) || 1),
      0
    );

    const order = new Order({
      userId: req.client?._id ? new mongoose.Types.ObjectId(req.client._id) : null,
      guestId: req.client?._id ? "" : String(guestId),
      orderCode,
      fullName,
      email,
      phone,
      address,
      method,
      cart: allLines.map((it) => ({
        productId: it.productId,
        variantId: it.variantId,
        name: it.name,
        price: it.price,
        quantity: it.quantity,
        image: it.image,
      })),
      bundles: validated.map(({ bundle, result }) => ({
        bundleId: String(bundle.bundleId),
        name: typeof bundle?.name === "string" ? bundle.name : "",
        bracelet: result.braceletSnapshot,
        items: result.itemsSnapshot,
        rulesSnapshot: {
          slotCount: result.slotCount,
          recommendedCharms: result.recommendedCharms,
          clipZonePercents: result.clipZonePercents,
        },
        priceSnapshot: result.pricing,
        quantity: Number(bundle?.quantity) || 1,
      })),
      totalPrice,
      deleted: false,
      checkStatus: false,
    });

    await order.save();

    // Clear selected bundles from cart.
    await Cart.updateOne(cartKey, { $pull: { bundles: { bundleId: { $in: bundleIds } } } });

    return res.status(201).json({
      message: "Tạo đơn hàng thành công",
      data: order,
    });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi khi tạo đơn hàng", error: error.message });
  }
};

module.exports.lookupOrders = async (req, res) => {
  try {
    const phone = normalizePhone(req.query.phone);
    const email = normalizeEmail(req.query.email);
    if (!phone && !email) {
      return res.status(400).json({ message: "Thiếu phone hoặc email" });
    }

    const find = { deleted: false };
    if (phone && email) {
      find.$or = [{ phone }, { email }];
    } else if (phone) {
      find.phone = phone;
    } else {
      find.email = email;
    }

    const orders = await Order.find(find)
      .sort({ createdAt: -1 })
      .select(
        "orderCode fullName email phone totalPrice status method payStatus createdAt updatedAt"
      )
      .lean();

    return res.status(200).json({ data: orders || [] });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi khi tra cứu đơn hàng", error: error.message });
  }
};

module.exports.getOrderByCode = async (req, res) => {
  try {
    const orderCode = String(req.params.orderCode || "").trim();
    if (!orderCode) {
      return res.status(400).json({ message: "Thiếu orderCode" });
    }

    const order = await Order.findOne({ orderCode, deleted: false }).lean();
    if (!order) {
      return res.status(404).json({ message: "Đơn hàng không tồn tại" });
    }

    return res.status(200).json({ data: order });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi khi lấy chi tiết đơn", error: error.message });
  }
};

// POST /api/public/orders/email
// Sends an email with a summary of orders for a given email.
module.exports.emailOrders = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ message: "Email không hợp lệ" });
    }

    const orders = await Order.find({ deleted: false, email })
      .sort({ createdAt: -1 })
      .select("orderCode totalPrice status createdAt")
      .lean();

    const safeEmail = escapeHtml(email);
    const subject = "Tra cứu đơn hàng";
    const rows = (orders || [])
      .slice(0, 50)
      .map((o) => {
        const code = escapeHtml(o.orderCode);
        const status = escapeHtml(statusLabelVI(o.status));
        const createdAt = o.createdAt ? new Date(o.createdAt).toLocaleString("vi-VN") : "";
        const total = (Number(o.totalPrice) || 0).toLocaleString("vi-VN") + "₫";
        return `<tr>
  <td style="padding:8px 10px;border-bottom:1px solid #eee;">${code}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eee;">${status}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eee;">${escapeHtml(createdAt)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(
    total
  )}</td>
</tr>`;
      })
      .join("\n");

    const content = `
<div style="font-family:Arial,sans-serif;line-height:1.5">
  <h2 style="margin:0 0 10px">Tra cứu đơn hàng</h2>
  <div style="margin:0 0 12px">Email: <b>${safeEmail}</b></div>
  ${
    orders?.length
      ? `<table style="width:100%;border-collapse:collapse">
  <thead>
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #111">Mã đơn</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #111">Trạng thái</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #111">Thời gian</th>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #111">Tổng tiền</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
<div style="margin-top:12px;font-size:12px;color:#666">Nếu bạn không yêu cầu tra cứu đơn hàng, có thể bỏ qua email này.</div>`
      : `<div>Không tìm thấy đơn hàng nào gắn với email này.</div>`
  }
</div>`;

    // Always respond success to avoid leaking whether an email has orders.
    try {
      mailHelper.sendMail(email, subject, content);
    } catch {
      // ignore mail transport errors here; caller still gets 200.
    }

    return res
      .status(200)
      .json({ message: "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi danh sách đơn hàng." });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi khi gửi email tra cứu", error: error.message });
  }
};
