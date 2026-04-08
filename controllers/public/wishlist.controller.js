const mongoose = require("mongoose");
const Wishlist = require("../../models/wishlist.model");
const Product = require("../../models/product.model");

const findVariantByCode = (product, variantCode) => {
  const code = String(variantCode || "");
  return (product?.variants || []).find((v) => String(v?.code) === code) || null;
};

module.exports.listWishlist = async (req, res) => {
  try {
    const userId = req.client?._id;
    if (!userId) {
      return res.status(401).json({ code: "error", message: "Unauthorized" });
    }

    const items = await Wishlist.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .populate({ path: "productId", select: "name slug variants deleted" })
      .lean();

    const data = (items || [])
      .filter((it) => it?.productId && it?.productId?.deleted === false)
      .map((it) => {
        const p = it.productId;
        const v = it.variantCode ? findVariantByCode(p, it.variantCode) : (p?.variants || [])[0] || null;
        const image = (v?.images || [])[0] || (p?.variants?.[0]?.images || [])[0] || "";
        return {
          _id: it._id,
          productId: p?._id,
          variantCode: String(it.variantCode || ""),
          createdAt: it.createdAt,
          product: {
            name: p?.name || "",
            slug: p?.slug || "",
            image,
            price: v?.price ?? null,
          },
        };
      });

    return res.status(200).json({ data });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.addToWishlist = async (req, res) => {
  try {
    const userId = req.client?._id;
    if (!userId) {
      return res.status(401).json({ code: "error", message: "Unauthorized" });
    }

    const { productId, variantCode } = req.body || {};
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      return res.status(400).json({ message: "productId không hợp lệ" });
    }

    const product = await Product.findOne({ _id: new mongoose.Types.ObjectId(productId), deleted: false }).lean();
    if (!product) {
      return res.status(404).json({ message: "Không tìm thấy sản phẩm" });
    }

    const safeVariantCode = String(variantCode || "").trim();
    if (safeVariantCode) {
      const ok = (product?.variants || []).some((v) => String(v?.code) === safeVariantCode);
      if (!ok) {
        return res.status(400).json({ message: "variantCode không hợp lệ" });
      }
    }

    const doc = await Wishlist.findOneAndUpdate(
      {
        userId: new mongoose.Types.ObjectId(userId),
        productId: new mongoose.Types.ObjectId(productId),
        variantCode: safeVariantCode,
      },
      {
        $setOnInsert: {
          userId: new mongoose.Types.ObjectId(userId),
          productId: new mongoose.Types.ObjectId(productId),
          variantCode: safeVariantCode,
        },
      },
      { upsert: true, new: true }
    ).lean();

    return res.status(201).json({ data: doc });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.removeFromWishlist = async (req, res) => {
  try {
    const userId = req.client?._id;
    if (!userId) {
      return res.status(401).json({ code: "error", message: "Unauthorized" });
    }

    const { productId } = req.params;
    const safeVariantCode = String(req.query.variantCode || "").trim();
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      return res.status(400).json({ message: "productId không hợp lệ" });
    }

    await Wishlist.deleteOne({
      userId: new mongoose.Types.ObjectId(userId),
      productId: new mongoose.Types.ObjectId(productId),
      variantCode: safeVariantCode,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
