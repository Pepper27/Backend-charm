const mongoose = require("mongoose");
const Design = require("../../models/design.model");
const Product = require("../../models/product.model");
const AccountClient = require("../../models/accountClient.model");

const findVariantByCode = (product, variantCode) => {
  const code = String(variantCode || "");
  return (product?.variants || []).find((v) => String(v?.code) === code) || null;
};

module.exports.getDesigns = async (req, res) => {
  try {
    const page = req.query.page ? Number.parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 10;
    const keyword = String(req.query.keyword || "").trim();

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 10;
    const skip = (safePage - 1) * safeLimit;

    const rx = keyword ? new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
    const keywordObjectId = keyword && mongoose.Types.ObjectId.isValid(keyword) ? new mongoose.Types.ObjectId(keyword) : null;

    const or = [];
    if (keywordObjectId) or.push({ userId: keywordObjectId });
    if (rx) {
      or.push({ name: rx }, { guestId: rx }, { "user.fullName": rx }, { "user.email": rx });
    }
    const matchStage = or.length ? { $match: { $or: or } } : null;

    const pipeline = [
      {
        $lookup: {
          from: "account-client",
          let: { uid: "$userId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $match: { deleted: false } },
            { $project: { fullName: 1, email: 1 } },
          ],
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      ...(matchStage ? [matchStage] : []),
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: safeLimit }],
          meta: [{ $count: "total" }],
        },
      },
    ];

    const agg = await Design.aggregate(pipeline);
    const data = agg?.[0]?.data || [];
    const total = agg?.[0]?.meta?.[0]?.total || 0;
    const totalPage = Math.max(Math.ceil(total / safeLimit), 1);

    return res.status(200).json({
      data: data || [],
      total,
      currentPage: safePage,
      totalPage,
    });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi", error: error.message });
  }
};

module.exports.deleteDesignById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Id không hợp lệ" });
    }

    const deleted = await Design.findByIdAndDelete(id).lean();
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Không tìm thấy design!" });
    }
    return res.status(200).json({ success: true, message: "Xóa design thành công!" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports.getDesignById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const design = await Design.findById(id).lean();
    if (!design) {
      return res.status(404).json({ message: "Không tìm thấy design" });
    }

    let user = null;
    if (design?.userId && mongoose.Types.ObjectId.isValid(String(design.userId))) {
      user = await AccountClient.findOne({ _id: design.userId, deleted: false }).lean();
    }

    const braceletId = design?.bracelet?.productId;
    const braceletVariantCode = design?.bracelet?.variantCode;
    const sizeCm = design?.bracelet?.sizeCm;

    let braceletProduct = null;
    let braceletImage = "";
    if (braceletId && mongoose.Types.ObjectId.isValid(braceletId)) {
      braceletProduct = await Product.findOne({ _id: braceletId, deleted: false }).lean();
      const bv = findVariantByCode(braceletProduct, braceletVariantCode);
      braceletImage = (bv?.images || [])[0] || (braceletProduct?.variants?.[0]?.images || [])[0] || "";
    }

    const items = Array.isArray(design?.items) ? design.items : [];
    const charmIds = [...new Set(items.map((it) => String(it?.charmProductId || "")).filter(Boolean))]
      .filter((v) => mongoose.Types.ObjectId.isValid(v))
      .map((v) => new mongoose.Types.ObjectId(v));

    const charmProducts = charmIds.length
      ? await Product.find({ _id: { $in: charmIds }, deleted: false }).lean()
      : [];
    const charmById = new Map(charmProducts.map((p) => [String(p._id), p]));

    const itemsResolved = items.map((it) => {
      const p = charmById.get(String(it?.charmProductId));
      const v = findVariantByCode(p, it?.charmVariantCode);
      const image = (v?.images || [])[0] || (p?.variants?.[0]?.images || [])[0] || "";
      return {
        slotIndex: Number.isFinite(Number(it?.slotIndex)) ? Number(it.slotIndex) : it?.slotIndex,
        charmProductId: String(it?.charmProductId || ""),
        charmVariantCode: String(it?.charmVariantCode || ""),
        charmName: p?.name || "",
        charmImage: image,
      };
    });

    return res.status(200).json({
      data: {
        ...design,
        braceletDisplay: {
          productId: braceletId || "",
          variantCode: braceletVariantCode || "",
          sizeCm: sizeCm ?? null,
          name: braceletProduct?.name || "",
          image: braceletImage,
        },
        itemsResolved,
        user: {
          id: user ? String(user._id) : design?.userId ? String(design.userId) : null,
          fullName: user?.fullName || null,
          email: user?.email || null,
          guestId: design?.guestId || "",
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi", error: error.message });
  }
};
