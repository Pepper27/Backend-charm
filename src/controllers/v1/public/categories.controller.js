const Category = require("../../../models/category.model");
const Collection = require("../../../models/collection.model");
const Product = require("../../../models/product.model");
const v1 = require("../../../helper/v1-response.helper");

// GET /api/v1/public/categories?root=1
module.exports.list = async (req, res) => {
  try {
    const onlyRoot = String(req.query.root || "1").trim() !== "0";

    const find = { deleted: false };
    if (onlyRoot) {
      find.$or = [{ parent: "" }, { parent: null }, { parent: { $exists: false } }];
    }
    
    const categories = await Category.find(find)
      .select("name slug avatar parent position")
      .sort({ position: 1, createdAt: -1 })
      .lean();
    const products = await Product.find({ deleted: false })
      .select("category collections")
      .lean();

    const mapCategoryCollections = {};

    for (const p of products) {
      const catId = String(p.category || "");
      if (!catId) continue;
      if (!mapCategoryCollections[catId]) {
        mapCategoryCollections[catId] = new Set();
      }
      (p.collections || []).forEach((c) => {
        mapCategoryCollections[catId].add(String(c));
      });
    }
    const allCollectionIds = [
      ...new Set(
        Object.values(mapCategoryCollections).flatMap((set) => [...set])
      ),
    ];
    const collections = await Collection.find({
      _id: { $in: allCollectionIds },
      deleted: false,
    })
      .select("name slug")
      .lean();
    const collectionMap = {};
    collections.forEach((c) => {
      collectionMap[String(c._id)] = c;
    });

    const categoriesWithCollections = categories.map((cat) => {
      const colIds = mapCategoryCollections[String(cat._id)] || new Set();
      return {
        ...cat,
        collections: [...colIds]
          .map((id) => collectionMap[id])
          .filter(Boolean),
      };
    });
    return v1.ok(res, categoriesWithCollections || []);
  } catch (error) {
    return v1.serverError(res, error);
  }
};
