const mongoose = require("mongoose");
const Product = require("../../../models/product.model");

const { parseIntSafe } = require("../../../helper/number.helper");
const { escapeRegex } = require("../../../helper/escape-regex.helper");
const v1 = require("../../../helper/v1-response.helper");

// GET /api/v1/public/products
// Query: page, limit, q, categorySlug
module.exports.list = async (req, res) => {
  try {
    const page = Math.max(parseIntSafe(req.query.page, 1), 1);
    const limit = Math.min(Math.max(parseIntSafe(req.query.limit, 12), 1), 50);
    const skip = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const categorySlug = String(req.query.categorySlug || "").trim();

    const match = { deleted: false };
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      match.$or = [{ name: rx }, { slug: rx }];
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
      ...(categorySlug ? [{ $match: { "categoryDoc.slug": String(categorySlug) } }] : []),
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
