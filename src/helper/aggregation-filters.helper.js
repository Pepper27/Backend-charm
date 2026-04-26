const mongoose = require("mongoose");
const Product = require("../models/product.model");
const Material = require("../models/material.model");
const Color = require("../models/color.model");
const Size = require("../models/size.model");
const Theme = require("../models/theme.model");
const Collection = require("../models/collection.model");
const Category = require("../models/category.model");

// Helper function to get aggregated filters for a given match query
async function getAggregatedFilters(matchQuery = {}) {
  try {
    const baseMatch = { deleted: false, ...(matchQuery || {}) };

    // Materials / Colors / Sizes counts (merge options.* and variants.*)
    const [materialsAgg, colorsAgg, sizesAgg] = await Promise.all([
      Product.aggregate([
        { $match: baseMatch },
        {
          $project: {
            merged: { $concatArrays: ["$options.materials", { $map: { input: "$variants", as: "v", in: "$$v.material" } }] },
          },
        },
        { $unwind: "$merged" },
        { $group: { _id: "$merged", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Product.aggregate([
        { $match: baseMatch },
        {
          $project: {
            merged: { $concatArrays: ["$options.colors", { $map: { input: "$variants", as: "v", in: "$$v.color" } }] },
          },
        },
        { $unwind: "$merged" },
        { $group: { _id: "$merged", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Product.aggregate([
        { $match: baseMatch },
        {
          $project: {
            merged: { $concatArrays: ["$options.sizes", { $map: { input: "$variants", as: "v", in: "$$v.size" } }] },
          },
        },
        { $unwind: "$merged" },
        { $group: { _id: "$merged", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    // Price ranges - fixed buckets: under 500k, 500k-1M, above 1M
    // Prefer precomputed priceMin when available, fallback to min(variants.price)
    const priceStats = await Product.aggregate([
      { $match: baseMatch },
      { $addFields: { minVariantPrice: { $ifNull: ["$priceMin", { $min: "$variants.price" }] } } },
      {
        $group: {
          _id: null,
          under500k: { $sum: { $cond: [{ $lte: ["$minVariantPrice", 500000] }, 1, 0] } },
          between500k_1m: { $sum: { $cond: [{ $and: [{ $gt: ["$minVariantPrice", 500000] }, { $lte: ["$minVariantPrice", 1000000] }] }, 1, 0] } },
          above1m: { $sum: { $cond: [{ $gt: ["$minVariantPrice", 1000000] }, 1, 0] } },
        },
      },
    ]);

    const priceAgg = priceStats[0] || { under500k: 0, between500k_1m: 0, above1m: 0 };

    // In-stock / out-of-stock counts
    const stockAgg = await Product.aggregate([
      { $match: baseMatch },
      { $addFields: { totalQty: { $sum: "$variants.quantity" } } },
      {
        $group: {
          _id: null,
          inStock: { $sum: { $cond: [{ $gt: ["$totalQty", 0] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $lte: ["$totalQty", 0] }, 1, 0] } },
        },
      },
    ]);

    const stockCounts = stockAgg[0] || { inStock: 0, outOfStock: 0 };

    // Enrich material/color/size keys by resolving to DB docs when possible
    const materialKeys = materialsAgg.map((m) => String(m._id)).filter(Boolean);
    const colorKeys = colorsAgg.map((c) => String(c._id)).filter(Boolean);
    const sizeKeys = sizesAgg.map((s) => String(s._id)).filter(Boolean);

    // Fetch matching docs by _id or name
    const [materialDocsById, materialDocsByName] = await Promise.all([
      Material.find({ _id: { $in: materialKeys.filter(k => mongoose.Types.ObjectId.isValid(k)) }, deleted: false }).lean(),
      Material.find({ name: { $in: materialKeys.filter(k => !mongoose.Types.ObjectId.isValid(k)) }, deleted: false }).lean(),
    ]);
    const materialDocs = [...materialDocsById, ...materialDocsByName];

    const [colorDocsById, colorDocsByName] = await Promise.all([
      Color.find({ _id: { $in: colorKeys.filter(k => mongoose.Types.ObjectId.isValid(k)) }, deleted: false }).lean(),
      Color.find({ name: { $in: colorKeys.filter(k => !mongoose.Types.ObjectId.isValid(k)) }, deleted: false }).lean(),
    ]);
    const colorDocs = [...colorDocsById, ...colorDocsByName];

    const [sizeDocsById, sizeDocsByName] = await Promise.all([
      Size.find({ _id: { $in: sizeKeys.filter(k => mongoose.Types.ObjectId.isValid(k)) }, deleted: false }).lean(),
      Size.find({ name: { $in: sizeKeys.filter(k => !mongoose.Types.ObjectId.isValid(k)) }, deleted: false }).lean(),
    ]);
    const sizeDocs = [...sizeDocsById, ...sizeDocsByName];

    // Map aggregation results into final arrays with counts
    const materials = materialsAgg.map((m) => {
      const key = String(m._id);
      const doc = materialDocs.find(d => String(d._id) === key) || materialDocs.find(d => String(d.name) === key);
      return { _id: doc?._id || key, name: doc?.name || key, count: m.count };
    });

    const colors = colorsAgg.map((c) => {
      const key = String(c._id);
      const doc = colorDocs.find(d => String(d._id) === key) || colorDocs.find(d => String(d.name) === key);
      return { _id: doc?._id || key, name: doc?.name || key, count: c.count };
    });

    const sizes = sizesAgg.map((s) => {
      const key = String(s._id);
      const doc = sizeDocs.find(d => String(d._id) === key) || sizeDocs.find(d => String(d.name) === key);
      return { _id: doc?._id || key, name: doc?.name || key, count: s.count };
    });

    const price_ranges = [
      { key: 'under_500k', min: 0, max: 500000, label: 'Dưới 500.000đ', count: priceAgg.under500k || 0 },
      { key: '500k_1m', min: 500001, max: 1000000, label: '500.001đ - 1.000.000đ', count: priceAgg.between500k_1m || 0 },
      { key: 'above_1m', min: 1000001, max: Number.MAX_SAFE_INTEGER, label: 'Trên 1.000.000đ', count: priceAgg.above1m || 0 },
    ];

    const inStock = [
      { key: 'in_stock', label: 'Còn hàng', count: stockCounts.inStock || 0 },
      { key: 'out_of_stock', label: 'Hết hàng', count: stockCounts.outOfStock || 0 },
    ];

    return {
      materials,
      colors,
      sizes,
      themes: [],
      collections: [],
      price_ranges,
      inStock,
    };
  } catch (error) {
    console.error('Error getting aggregated filters:', error);
    return {
      materials: [],
      colors: [],
      sizes: [],
      themes: [],
      collections: [],
      price_ranges: [],
      inStock: [],
    };
  }
}

// Helper function to generate price ranges
function generatePriceRanges(minPrice, maxPrice) {
  const ranges = [];
  const step = 1000000; // 1 million VND steps
  
  // Dưới 1.000.000đ
  ranges.push({
    min: 0,
    max: 1000000,
    label: 'Dưới 1.000.000đ'
  });
  
  // Create middle ranges
  for (let i = 1000000; i < maxPrice; i += step) {
    ranges.push({
      min: i + 1,
      max: i + step,
      label: `${(i + 1).toLocaleString('vi-VN')}đ - ${(i + step).toLocaleString('vi-VN')}đ`
    });
  }
  
  // Trên [max price]
  if (maxPrice > 0) {
    ranges.push({
      min: Math.max(7000001, maxPrice),
      max: Number.MAX_SAFE_INTEGER,
      label: `Trên ${Math.max(7000001, maxPrice).toLocaleString('vi-VN')}đ`
    });
  }
  
  // Limit to 5 ranges max
  return ranges.slice(0, 5);
}

module.exports = {
  getAggregatedFilters,
  generatePriceRanges
};
