const Order = require("../../models/order.model");
const Product = require("../../models/product.model");
const helper = require("../../helper/generate.helper");

module.exports.createOrder = async (req, res) => {
  try {
    const { userId, cart, method, address, phone } = req.body;

    if (!userId || !Array.isArray(cart) || !cart.length || !address || !phone) {
      return res.status(400).json({ message: "Thiếu thông tin yêu cầu để tạo đơn hàng" });
    }

    const sanitizedCart = cart.map((item) => ({
      productId: item.productId || "",
      variantId: item.variantId || "",
      price: Number(item.price) || 0,
      quantity: Number(item.quantity) || 0,
      // Optional snapshot fields; we'll fill from DB if missing.
      name: String(item.name || "").trim(),
      image: String(item.image || "").trim(),
    }));

    const totalPrice = sanitizedCart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    if (totalPrice <= 0) {
      return res.status(400).json({ message: "Giá trị tổng đơn hàng không hợp lệ" });
    }

    const variantQuantities = {};
    // Enrich items with product/variant snapshot data while validating stock.
    for (const item of sanitizedCart) {
      if (!item.variantId) {
        return res.status(400).json({ message: "Thiếu variantId trong giỏ hàng" });
      }

      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) {
        return res.status(400).json({ message: "Số lượng phải lớn hơn 0" });
      }

      variantQuantities[item.variantId] = (variantQuantities[item.variantId] || 0) + quantity;
    }

    const productUpdates = [];
    for (const [variantId, requiredQuantity] of Object.entries(variantQuantities)) {
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

      // Fill snapshot for items referencing this variant.
      // This keeps admin order UI stable even if product later changes/deletes.
      for (const item of sanitizedCart) {
        if (item.variantId !== variantId) continue;
        if (!item.productId) item.productId = product._id;
        if (!item.name) item.name = product.name || "";
        if (!item.image) item.image = (variant.images && variant.images[0]) || "";
      }
    }

    for (const product of productUpdates) {
      await product.save();
    }

    const orderCode = `ORD${Date.now()}${helper.generateRandomNumber(4)}`;

    const order = new Order({
      userId,
      orderCode,
      cart: sanitizedCart,
      totalPrice,
      method: method,
      address,
      phone,
      deleted: false,
      checkStatus: false,
    });

    await order.save();

    return res.status(201).json({
      message: "Tạo đơn hàng thành công",
      data: order,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi khi tạo đơn hàng",
      error: error.message,
    });
  }
};
