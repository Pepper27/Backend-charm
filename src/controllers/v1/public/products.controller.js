const mongoose = require("mongoose");
const Product = require("../../../models/product.model");
const Category = require("../../../models/category.model");

const { parseIntSafe } = require("../../../helper/number.helper");
const { escapeRegex } = require("../../../helper/escape-regex.helper");
const v1 = require("../../../helper/v1-response.helper");

// Collects all descendant category ids (including rootId itself).
// Category.parent is stored as a stringified ObjectId in this codebase.
const collectDescendantCategoryIds = async (rootId) => {
  const root = String(rootId || "").trim();
  if (!root || !mongoose.isValidObjectId(root)) return [];

  const seen = new Set([root]);
  let frontier = [root];

  while (frontier.length) {
    const batch = frontier;
    frontier = [];

    const children = await Category.find({ deleted: false, parent: { $in: batch } })
      .select("_id parent")
      .lean();

    for (const c of children || []) {
      const id = String(c?._id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      frontier.push(id);
    }
  }

  return [...seen].map((id) => new mongoose.Types.ObjectId(id));
};

// GET /api/v1/public/products
// Query: page, limit, q, categorySlug
// simple JSON parse helper that tolerates already-parsed values
const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      // fallback to comma-separated or single value string
      return value;
    }
  }
  return value;
};

module.exports.list = async (req, res) => {
  try {
    const page = Math.max(parseIntSafe(req.query.page, 1), 1);
    const limit = Math.min(Math.max(parseIntSafe(req.query.limit, 12), 1), 50);
    const skip = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const categorySlug = String(req.query.categorySlug || "").trim();

    // Parse filters JSON (expected shape: { materials: [id], colors: [id], sizes: [id], themes: [id], collections: [id], price: { min, max } })
    const rawFilters = parseJsonField(req.query.filters, {});
    const filters = rawFilters || {};

    let categoryIds = null;
    if (categorySlug) {
      const cat = await Category.findOne({ deleted: false, slug: categorySlug })
        .select("_id")
        .lean();
      if (!cat?._id) {
        return v1.ok(res, [], { page, limit, total: 0, totalPages: 1 });
      }
      categoryIds = await collectDescendantCategoryIds(cat._id);
    }

    const match = { deleted: false };
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      match.$or = [{ name: rx }, { slug: rx }];
    }

    // Build facet filters (OR within same attribute group is handled by $in)
    // Accept either arrays or comma-separated strings of ObjectId values.
    const toIdArray = (input) => {
      if (!input) return [];
      if (Array.isArray(input)) return input.map(String).filter(Boolean);
      if (typeof input === "string") {
        return input
          .split(",")
          .map((s) => String(s).trim())
          .filter(Boolean);
      }
      return [];
    };

    const tryToObjectIds = (arr) =>
      arr
        .filter(Boolean)
        .filter((v) => mongoose.Types.ObjectId.isValid(v))
        .map((v) => new mongoose.Types.ObjectId(v));

    // facet keys we support
    const facetKeys = ["materials", "colors", "sizes", "themes", "collections"];
    for (const key of facetKeys) {
      const vals = toIdArray(filters[key]);
      const ids = tryToObjectIds(vals);
      if (ids.length) {
        // product stores these as arrays of ObjectId
        match[key] = { $in: ids };
      }
    }

    // Price filter: we use precomputed priceMin/priceMax on product document.
    // Requested price range (min..max) should overlap with product range.
    const priceRaw = filters.price || {};
    const priceMinReq = priceRaw.min !== undefined ? Number(priceRaw.min) : undefined;
    const priceMaxReq = priceRaw.max !== undefined ? Number(priceRaw.max) : undefined;
    if (!Number.isNaN(priceMinReq) && !Number.isNaN(priceMinReq)) {
      // Ensure priceMax >= requested min
      match.priceMax = match.priceMax || {};
      match.priceMax.$gte = priceMinReq;
    }
    if (!Number.isNaN(priceMaxReq) && !Number.isNaN(priceMaxReq)) {
      // Ensure priceMin <= requested max
      match.priceMin = match.priceMin || {};
      match.priceMin.$lte = priceMaxReq;
    }

    // category is stored as ObjectId in schema, but some older data might be string.
    // We'll resolve by joining category collection by _id and filtering by category slug.
    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: "category",
          localField: "category",
          foreignField: "_id",
          as: "categoryDoc",
        },
      },
      { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
      ...(categoryIds ? [{ $match: { "categoryDoc._id": { $in: categoryIds } } }] : []),
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          rows: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                name: 1,
                slug: 1,
                description: 1,
                variants: 1,
                category: {
                  _id: "$categoryDoc._id",
                  name: "$categoryDoc.name",
                  slug: "$categoryDoc.slug",
                },
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await Product.aggregate(pipeline);
    const rows = result?.rows || [];
    const total = result?.totalCount?.[0]?.count || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return v1.ok(res, rows, { page, limit, total, totalPages });
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// GET /api/v1/public/products/slug/:slug
module.exports.getBySlug = async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) {
      return v1.fail(res, 400, "BAD_REQUEST", "Missing slug");
    }

    const [doc] = await Product.aggregate([
      { $match: { deleted: false, slug } },
      {
        $lookup: {
          from: "category",
          localField: "category",
          foreignField: "_id",
          as: "categoryDoc",
        },
      },
      { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1,
          slug: 1,
          description: 1,
          variants: 1,
          category: {
            _id: "$categoryDoc._id",
            name: "$categoryDoc.name",
            slug: "$categoryDoc.slug",
          },
        },
      },
      { $limit: 1 },
    ]);

    if (!doc) {
      return v1.fail(res, 404, "NOT_FOUND", "Product not found");
    }

    return v1.ok(res, doc);
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// GET /api/v1/public/products/:id
module.exports.getById = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.isValidObjectId(id)) {
      return v1.fail(res, 400, "BAD_REQUEST", "Invalid id");
    }

    const _id = new mongoose.Types.ObjectId(id);
    const [doc] = await Product.aggregate([
      { $match: { deleted: false, _id } },
      {
        $lookup: {
          from: "category",
          localField: "category",
          foreignField: "_id",
          as: "categoryDoc",
        },
      },
      { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1,
          slug: 1,
          description: 1,
          variants: 1,
          category: {
            _id: "$categoryDoc._id",
            name: "$categoryDoc.name",
            slug: "$categoryDoc.slug",
          },
        },
      },
      { $limit: 1 },
    ]);

    if (!doc) {
      return v1.fail(res, 404, "NOT_FOUND", "Product not found");
    }

    return v1.ok(res, doc);
  } catch (error) {
    return v1.serverError(res, error);
  }
};
