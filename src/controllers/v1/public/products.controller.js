const mongoose = require("mongoose");
const Product = require("../../../models/product.model");
const Category = require("../../../models/category.model");

const { parseIntSafe } = require("../../../helper/number.helper");
const { escapeRegex } = require("../../../helper/escape-regex.helper");
const v1 = require("../../../helper/v1-response.helper");
const { getAggregatedFilters } = require("../../../helper/aggregation-filters.helper");

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
    const limit = Math.min(Math.max(parseIntSafe(req.query.limit, 24), 1), 100);
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

    // facet keys we support (only themes and collections use ObjectId references)
    const facetKeys = ["themes", "collections"];
    for (const key of facetKeys) {
      const vals = toIdArray(filters[key]);
      const ids = tryToObjectIds(vals);
      if (ids.length) {
        // product stores these as arrays of ObjectId
        match[key] = { $in: ids };
      }
    }

    // Handle materials, colors, and sizes (string values in options and variants)
    const stringFacetKeys = ["materials", "colors", "sizes"];
    for (const key of stringFacetKeys) {
      const vals = toIdArray(filters[key]);
      if (vals.length > 0) {
        // Convert to string values
        const stringValues = vals.map(String).filter(Boolean);
        
        if (stringValues.length > 0) {
          // Match in options array (e.g., "options.materials")
          const optionsPath = `options.${key.slice(0, -1)}`; // "materials" -> "options.material"
          
          // Match in variants (e.g., "variants.material")
          const variantPath = `variants.${key.slice(0, -1)}`; // "materials" -> "variants.material"
          
          // Add to existing $or array or create new one
          if (!match.$or) match.$or = [];
          
          match.$or.push(
            { [optionsPath]: { $in: stringValues } },
            { [variantPath]: { $in: stringValues } }
          );
        }
      }
    }

    // Price filter: we use precomputed priceMin/priceMax on product document.
    // Requested price range (min..max) should overlap with product range.
    const priceRaw = filters.price || {};
    const priceMinReq = priceRaw.min !== undefined ? Number(priceRaw.min) : undefined;
    const priceMaxReq = priceRaw.max !== undefined ? Number(priceRaw.max) : undefined;
    if (!Number.isNaN(priceMinReq) && priceMinReq !== undefined) {
      // Ensure priceMax >= requested min
      match.priceMax = match.priceMax || {};
      match.priceMax.$gte = priceMinReq;
    }
    if (!Number.isNaN(priceMaxReq) && priceMaxReq !== undefined) {
      // Ensure priceMin <= requested max
      match.priceMin = match.priceMin || {};
      match.priceMin.$lte = priceMaxReq;
    }

    // Handle products with zero/null prices when price filtering is applied
    if (match.priceMax || match.priceMin) {
      // Include products with zero/null prices in price filtering
      match.$or = [
        { priceMin: { $exists: true, $ne: null, $ne: 0 }, priceMax: { $exists: true, $ne: null, $ne: 0 } },
        { priceMin: { $exists: false }, priceMax: { $exists: false } },
        { priceMin: 0, priceMax: 0 }
      ];
      // Apply the price filters to the first condition only
      if (match.priceMax) {
        match.$or[0].priceMax = match.priceMax;
        delete match.priceMax;
      }
      if (match.priceMin) {
        match.$or[0].priceMin = match.priceMin;
        delete match.priceMin;
      }
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
      ...(categoryIds ? [{ 
        $match: { 
          $or: [
            { "categoryDoc._id": { $in: categoryIds } },  // Products with valid categories
            { categoryDoc: { $exists: false } }            // Products without categories
          ]
        } 
      }] : []),
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

    // If client requested includeFilters=true, compute facet counts based on current match
    const includeFilters = String(req.query.includeFilters || '').toLowerCase() === 'true';
    let aggregatedFilters = null;
    if (includeFilters) {
      // Build a match object that mirrors the filters applied above so facet counts are faceted
      const facetMatch = { deleted: false };

      // Add text query if present
      if (q) facetMatch.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { slug: new RegExp(escapeRegex(q), 'i') }];

      // category scope
      if (categoryIds) facetMatch.category = { $in: categoryIds };

      // Accept CSV params for sizes/colors/materials/inStock/priceRanges if provided (legacy support)
      const toArray = (val) => {
        if (!val) return [];
        if (Array.isArray(val)) return val.map(String);
        return String(val).split(',').map((s) => s.trim()).filter(Boolean);
      };

      const sizesCsv = toArray(req.query.sizes || filters.sizes);
      const colorsCsv = toArray(req.query.colors || filters.colors);
      const materialsCsv = toArray(req.query.materials || filters.materials || filters.materials);
      const inStockCsv = toArray(req.query.inStock || filters.inStock);
      const priceRangesCsv = toArray(req.query.priceRanges || filters.priceRanges);

      // apply materials/colors/sizes filters into facetMatch similar to above logic
      if (materialsCsv.length) {
        facetMatch.$or = facetMatch.$or || [];
        facetMatch.$or.push({ 'options.material': { $in: materialsCsv } }, { 'variants.material': { $in: materialsCsv } });
      }
      if (colorsCsv.length) {
        facetMatch.$or = facetMatch.$or || [];
        facetMatch.$or.push({ 'options.color': { $in: colorsCsv } }, { 'variants.color': { $in: colorsCsv } });
      }
      if (sizesCsv.length) {
        facetMatch.$or = facetMatch.$or || [];
        facetMatch.$or.push({ 'options.size': { $in: sizesCsv } }, { 'variants.size': { $in: sizesCsv } });
      }

      // Handle priceRanges CSV: these are keys like 'under_500k','500k_1m','above_1m'
      if (priceRangesCsv.length) {
        // translate to min/max price constraints (match any product whose min variant price falls into any selected bucket)
        const priceOr = [];
        for (const key of priceRangesCsv) {
          if (key === 'under_500k') priceOr.push({ priceMin: { $lte: 500000 } });
          else if (key === '500k_1m') priceOr.push({ priceMin: { $gt: 500000, $lte: 1000000 } });
          else if (key === 'above_1m') priceOr.push({ priceMin: { $gt: 1000000 } });
        }
        if (priceOr.length) facetMatch.$or = facetMatch.$or ? facetMatch.$or.concat(priceOr) : priceOr;
      }

      // inStock filter
      if (inStockCsv.length) {
        const stockOr = [];
        if (inStockCsv.includes('in_stock')) stockOr.push({ $expr: { $gt: [{ $sum: '$variants.quantity' }, 0] } });
        if (inStockCsv.includes('out_of_stock')) stockOr.push({ $expr: { $lte: [{ $sum: '$variants.quantity' }, 0] } });
        if (stockOr.length) facetMatch.$or = facetMatch.$or ? facetMatch.$or.concat(stockOr) : stockOr;
      }

      aggregatedFilters = await getAggregatedFilters(facetMatch);
    }

    // Return response with filters (if requested)
    return v1.ok(res, rows, { meta: { page, limit, total, totalPages }, filters: aggregatedFilters });
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
