const mongoose = require("mongoose");

const Product = require("../../../models/product.model");
const RecentlyViewed = require("../../../models/recentlyViewed.model");
const v1 = require("../../../helper/v1-response.helper");
const { ensureGuestIdCookie } = require("../../../helper/guest.helper");

const MAX_ITEMS = 50;

const pickOwner = (req, res) => {
  if (req.auth?.role === "client" && req.auth?.id) {
    return { userId: new mongoose.Types.ObjectId(req.auth.id), guestId: null };
  }
  const guestId = ensureGuestIdCookie(req, res);
  return { userId: null, guestId: String(guestId) };
};

const ownerQuery = ({ userId, guestId }) => {
  if (userId) return { userId };
  return { guestId };
};

const pruneOwner = async ({ userId, guestId }) => {
  const q = ownerQuery({ userId, guestId });
  const ids = await RecentlyViewed.find(q)
    .sort({ viewedAt: -1 })
    .skip(MAX_ITEMS)
    .select("_id")
    .lean();
  if (ids?.length) {
    await RecentlyViewed.deleteMany({ _id: { $in: ids.map((d) => d._id) } });
  }
};

// GET /api/v1/public/recently-viewed
module.exports.list = async (req, res) => {
  try {
    const limit = Math.min(
      MAX_ITEMS,
      Math.max(1, Number.parseInt(String(req.query.limit || "12"), 10) || 12)
    );

    const owner = pickOwner(req, res);
    const items = await RecentlyViewed.find(ownerQuery(owner))
      .sort({ viewedAt: -1 })
      .limit(limit)
      .lean();

    if (!items.length) return v1.ok(res, []);

    const productIds = items
      .map((it) => it.productId)
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(id));

    const products = await Product.find({ _id: { $in: productIds }, deleted: false })
      .select("name slug variants priceMin priceMax")
      .lean();
    const pMap = new Map(products.map((p) => [String(p._id), p]));

    const data = items
      .map((it) => {
        const p = pMap.get(String(it.productId));
        if (!p) return null;

        const firstVariant = (p?.variants || [])[0] || null;
        const image = (firstVariant?.images || [])[0] || "";
        const price = firstVariant?.price ?? p?.priceMin ?? 0;

        return {
          _id: it._id,
          productId: p._id,
          variantCode: String(it.variantCode || ""),
          viewedAt: it.viewedAt,
          product: {
            name: p.name || "",
            slug: p.slug || "",
            image,
            price,
          },
        };
      })
      .filter(Boolean);

    return v1.ok(res, data);
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// POST /api/v1/public/recently-viewed
module.exports.track = async (req, res) => {
  try {
    const { productId, variantCode } = req.body || {};
    if (!productId || !mongoose.isValidObjectId(String(productId))) {
      return v1.fail(res, 400, "BAD_REQUEST", "Invalid productId");
    }

    const product = await Product.findOne({ _id: productId, deleted: false })
      .select("_id variants")
      .lean();
    if (!product) {
      return v1.fail(res, 404, "NOT_FOUND", "Product not found");
    }

    const safeVariantCode = String(variantCode || "").trim();
    if (safeVariantCode) {
      const ok = (product?.variants || []).some((v) => String(v?.code) === safeVariantCode);
      if (!ok) {
        return v1.fail(res, 400, "BAD_REQUEST", "Invalid variantCode");
      }
    }

    const owner = pickOwner(req, res);
    const q = { ...ownerQuery(owner), productId: new mongoose.Types.ObjectId(productId) };
    const update = {
      $set: {
        viewedAt: new Date(),
        variantCode: safeVariantCode,
      },
      $setOnInsert: {
        ...owner,
        productId: new mongoose.Types.ObjectId(productId),
      },
    };

    const doc = await RecentlyViewed.findOneAndUpdate(q, update, {
      upsert: true,
      new: true,
    }).lean();

    await pruneOwner(owner);
    return v1.created(res, doc);
  } catch (error) {
    // Duplicate key can happen under race; treat as ok.
    if (error && error.code === 11000) {
      return v1.ok(res, true);
    }
    return v1.serverError(res, error);
  }
};
