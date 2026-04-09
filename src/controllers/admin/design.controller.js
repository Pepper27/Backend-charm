const mongoose = require("mongoose");
const Design = require("../../models/design.model");
const Product = require("../../models/product.model");
const AccountClient = require("../../models/accountClient.model");
const Cart = require("../../models/cart.model");

const findVariantByCode = (product, variantCode) => {
  const code = String(variantCode || "");
  return (product?.variants || []).find((v) => String(v?.code) === code) || null;
};

module.exports.getDesigns = async (req, res) => {
  try {
    const page = req.query.page ? Number.parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 10;
    const keyword = String(req.query.keyword || "").trim();
    const includeBundles = String(req.query.includeBundles || "").trim() === "1";

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 10;
    const skip = (safePage - 1) * safeLimit;

    const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = keyword ? new RegExp(escapeRegex(keyword), "i") : null;
    const keywordObjectId =
      keyword && mongoose.Types.ObjectId.isValid(keyword)
        ? new mongoose.Types.ObjectId(keyword)
        : null;

    // 1) Saved designs (collection: designs)
    const savedPipeline = [
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
      ...(rx || keywordObjectId
        ? [
            {
              $match: {
                $or: [
                  ...(keywordObjectId ? [{ userId: keywordObjectId }] : []),
                  ...(rx
                    ? [{ name: rx }, { guestId: rx }, { "user.fullName": rx }, { "user.email": rx }]
                    : []),
                ],
              },
            },
          ]
        : []),
      {
        $project: {
          _id: 1,
          name: 1,
          guestId: 1,
          userId: 1,
          bracelet: 1,
          items: 1,
          rulesSnapshot: 1,
          priceSnapshot: 1,
          createdAt: 1,
          source: { $literal: "design" },
        },
      },
    ];

    // 2) Bundle designs (collection: carts.bundles)
    // These are the only "design" artifacts in guest MVP per agent.md.
    const bundlePipeline = [
      // Exclude anonymous guest carts (no persisted identity)
      // so admin does not see guest designs.
      { $match: { userId: { $regex: /^[a-fA-F0-9]{24}$/ } } },
      { $unwind: { path: "$bundles", preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          userObjId: { $toObjectId: "$userId" },
        },
      },
      {
        $lookup: {
          from: "account-client",
          let: { uid: "$userObjId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $match: { deleted: false } },
            { $project: { fullName: 1, email: 1 } },
          ],
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      ...(rx || keywordObjectId
        ? [
            {
              $match: {
                $or: [
                  ...(keywordObjectId ? [{ userObjId: keywordObjectId }] : []),
                  ...(rx
                    ? [
                        { "bundles.name": rx },
                        { guestId: rx },
                        { "user.fullName": rx },
                        { "user.email": rx },
                        { "bundles.bundleId": rx },
                      ]
                    : []),
                ],
              },
            },
          ]
        : []),
      {
        $project: {
          _id: { $concat: ["bundle:", "$bundles.bundleId"] },
          bundleId: "$bundles.bundleId",
          name: { $ifNull: ["$bundles.name", ""] },
          guestId: 1,
          userId: "$userObjId",
          rulesSnapshot: "$bundles.rulesSnapshot",
          priceSnapshot: "$bundles.priceSnapshot",
          createdAt: { $ifNull: ["$bundles.createdAt", "$updatedAt"] },
          source: { $literal: "bundle" },
          // keep a few fields to serve detail view without a second DB query if needed
          bracelet: "$bundles.bracelet",
          items: "$bundles.items",
        },
      },
    ];

    const [saved, bundles] = await Promise.all([
      Design.aggregate(savedPipeline),
      includeBundles ? Cart.aggregate(bundlePipeline) : Promise.resolve([]),
    ]);

    const combined = [...(saved || []), ...(bundles || [])].sort((a, b) => {
      const ta = new Date(a?.createdAt || 0).getTime();
      const tb = new Date(b?.createdAt || 0).getTime();
      return tb - ta;
    });

    const total = combined.length;
    const totalPage = Math.max(Math.ceil(total / safeLimit), 1);
    const pageItems = combined.slice(skip, skip + safeLimit);

    // Attach user info for bundle rows (saved designs don't include user object after projection)
    const userIds = [
      ...new Set(pageItems.map((d) => (d?.userId ? String(d.userId) : "")).filter(Boolean)),
    ]
      .filter((v) => mongoose.Types.ObjectId.isValid(v))
      .map((v) => new mongoose.Types.ObjectId(v));
    const users = userIds.length
      ? await AccountClient.find({ _id: { $in: userIds }, deleted: false })
          .select("fullName email")
          .lean()
      : [];
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const data = pageItems.map((d) => ({
      ...d,
      user: d?.userId ? userById.get(String(d.userId)) || null : null,
    }));

    return res.status(200).json({
      data,
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
    if (!id) {
      return res.status(400).json({ success: false, message: "Id không hợp lệ" });
    }

    // Bundle pseudo-id format: bundle:<bundleId>
    // Only allow deleting bundles when explicitly enabled.
    if (String(id).startsWith("bundle:") && String(req.query.includeBundles || "").trim() === "1") {
      const bundleId = String(id).slice("bundle:".length);
      if (!bundleId) return res.status(400).json({ success: false, message: "Id không hợp lệ" });

      const result = await Cart.updateMany(
        // Only allow deleting bundle designs tied to a real user.
        { userId: { $regex: /^[a-fA-F0-9]{24}$/ }, "bundles.bundleId": String(bundleId) },
        { $pull: { bundles: { bundleId: String(bundleId) } } }
      );

      if (!result?.modifiedCount) {
        return res.status(404).json({ success: false, message: "Không tìm thấy design!" });
      }
      return res.status(200).json({ success: true, message: "Xóa design thành công!" });
    }

    if (String(id).startsWith("bundle:")) {
      return res.status(400).json({ success: false, message: "Không hỗ trợ xóa bundle ở đây" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
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
    if (!id) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    let design = null;
    let user = null;

    // Bundle detail (guest MVP source)
    if (String(id).startsWith("bundle:")) {
      const bundleId = String(id).slice("bundle:".length);
      if (!bundleId) return res.status(400).json({ message: "Id không hợp lệ" });

      const cart = await Cart.findOne({ "bundles.bundleId": String(bundleId) }).lean();
      const bundle =
        (cart?.bundles || []).find((b) => String(b.bundleId) === String(bundleId)) || null;
      if (!cart || !bundle) {
        return res.status(404).json({ message: "Không tìm thấy design" });
      }

      // Do not expose anonymous guest bundle designs in admin.
      const userObjId =
        cart?.userId && mongoose.Types.ObjectId.isValid(String(cart.userId))
          ? new mongoose.Types.ObjectId(String(cart.userId))
          : null;
      if (!userObjId) {
        return res.status(404).json({ message: "Không tìm thấy design" });
      }
      if (userObjId) {
        user = await AccountClient.findOne({ _id: userObjId, deleted: false }).lean();
      }

      design = {
        _id: `bundle:${bundleId}`,
        name: bundle?.name || "",
        guestId: cart?.guestId || "",
        userId: userObjId,
        bracelet: bundle?.bracelet,
        items: bundle?.items,
        rulesSnapshot: bundle?.rulesSnapshot,
        priceSnapshot: bundle?.priceSnapshot,
        createdAt: bundle?.createdAt || cart?.updatedAt || cart?.createdAt,
      };
    } else {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Id không hợp lệ" });
      }

      design = await Design.findById(id).lean();
      if (!design) {
        return res.status(404).json({ message: "Không tìm thấy design" });
      }

      if (design?.userId && mongoose.Types.ObjectId.isValid(String(design.userId))) {
        user = await AccountClient.findOne({ _id: design.userId, deleted: false }).lean();
      }
    }

    const braceletId = design?.bracelet?.productId;
    const braceletVariantCode = design?.bracelet?.variantCode;
    const sizeCm = design?.bracelet?.sizeCm;

    let braceletProduct = null;
    let braceletImage = "";
    if (braceletId && mongoose.Types.ObjectId.isValid(braceletId)) {
      braceletProduct = await Product.findOne({ _id: braceletId, deleted: false }).lean();
      const bv = findVariantByCode(braceletProduct, braceletVariantCode);
      braceletImage =
        (bv?.images || [])[0] || (braceletProduct?.variants?.[0]?.images || [])[0] || "";
    }

    const items = Array.isArray(design?.items) ? design.items : [];
    const charmIds = [
      ...new Set(items.map((it) => String(it?.charmProductId || "")).filter(Boolean)),
    ]
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
