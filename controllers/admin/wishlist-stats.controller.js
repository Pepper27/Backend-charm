const mongoose = require("mongoose");
const Wishlist = require("../../models/wishlist.model");

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports.getWishlistStatsByProduct = async (req, res) => {
  try {
    const page = req.query.page ? Number.parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 10;
    const keyword = String(req.query.keyword || "").trim();

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 10;
    const skip = (safePage - 1) * safeLimit;

    const rx = keyword ? new RegExp(escapeRegex(keyword), "i") : null;
    const keywordObjectId = keyword && mongoose.Types.ObjectId.isValid(keyword) ? new mongoose.Types.ObjectId(keyword) : null;

    const basePipeline = [
      // group by product
      {
        $group: {
          _id: "$productId",
          wishCount: { $sum: 1 },
          lastWishAt: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "product",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
      // only show active products (soft delete treated as inactive)
      { $match: { "product.deleted": false } },
      ...(rx || keywordObjectId
        ? [
            {
              $match: {
                $or: [
                  ...(keywordObjectId ? [{ _id: keywordObjectId }] : []),
                  ...(rx
                    ? [
                        { "product.name": rx },
                        { "product.slug": rx },
                      ]
                    : []),
                ],
              },
            },
          ]
        : []),
      {
        $project: {
          _id: 0,
          productId: "$_id",
          wishCount: 1,
          lastWishAt: 1,
          product: {
            _id: "$product._id",
            name: "$product.name",
            slug: "$product.slug",
            variants: "$product.variants",
          },
        },
      },
    ];

    const [result] = await Wishlist.aggregate([
      ...basePipeline,
      { $sort: { wishCount: -1, lastWishAt: -1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: safeLimit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const rows = result?.rows || [];
    const total = result?.totalCount?.[0]?.count || 0;
    const totalPage = Math.max(Math.ceil(total / safeLimit), 1);

    const data = rows.map((row) => {
      const p = row.product || {};
      const firstVariant = (p?.variants || [])[0] || null;
      const image = (firstVariant?.images || [])[0] || "";
      return {
        productId: row.productId,
        wishCount: row.wishCount,
        lastWishAt: row.lastWishAt,
        product: {
          _id: p?._id,
          name: p?.name || "",
          slug: p?.slug || "",
          image,
        },
      };
    });

    return res.status(200).json({
      data,
      total,
      currentPage: safePage,
      totalPage,
      limit: safeLimit,
    });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi", error: error.message });
  }
};
