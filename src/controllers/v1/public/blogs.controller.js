const v1 = require("../../../helper/v1-response.helper");
const Blog = require("../../../models/blog.model");

// GET /api/v1/public/blogs
module.exports.list = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(String(req.query.limit || "10"), 10) || 10)
    );
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      Blog.find({ deleted: false })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("name slug avatar createdAt")
        .lean(),
      Blog.countDocuments({ deleted: false }),
    ]);

    return v1.ok(res, rows, {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// GET /api/v1/public/blogs/slug/:slug
module.exports.getBySlug = async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return v1.fail(res, 400, "BAD_REQUEST", "Missing slug");

    const doc = await Blog.findOne({ deleted: false, slug })
      .select("name slug avatar content createdAt")
      .lean();

    if (!doc) return v1.fail(res, 404, "NOT_FOUND", "Blog not found");
    return v1.ok(res, doc);
  } catch (error) {
    return v1.serverError(res, error);
  }
};
