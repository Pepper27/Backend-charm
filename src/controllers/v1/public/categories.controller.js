const Category = require("../../../models/category.model");
const v1 = require("../../../helper/v1-response.helper");

// GET /api/v1/public/categories?root=1
module.exports.list = async (req, res) => {
  try {
    const onlyRoot = String(req.query.root || "1").trim() !== "0";

    const find = { deleted: false };
    if (onlyRoot) {
      find.$or = [{ parent: "" }, { parent: null }, { parent: { $exists: false } }];
    }

    // Include filter metadata so frontend can render category-specific filters
    const categories = await Category.find(find)
      .select("name slug avatar banner parent position visibleFilters filterOptions filterConfig")
      .sort({ position: 1, createdAt: -1 })
      .lean();

    return v1.ok(res, categories || []);
  } catch (error) {
    return v1.serverError(res, error);
  }
};
