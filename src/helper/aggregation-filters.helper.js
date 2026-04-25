const mongoose = require("mongoose");
const Product = require("../models/product.model");
const Material = require("../models/material.model");
const Color = require("../models/color.model");
const Size = require("../models/size.model");
const Theme = require("../models/theme.model");
const Collection = require("../models/collection.model");
const Category = require("../models/category.model");

// Helper function to get aggregated filters
async function getAggregatedFilters(categorySlug = "") {
  try {
    const filterQuery = { deleted: false };
    
    // If categorySlug is provided, get filters for that category and its children
    if (categorySlug) {
      const rootCat = await Category.findOne({ slug: categorySlug, deleted: false }).lean();
      if (rootCat) {
        // Include children categories
        const children = await Category.find({ 
          parent: String(rootCat._id), 
          deleted: false 
        }).select('_id').lean();
        
        const childIds = (children || []).map((c) => String(c._id));
        const resolvedCategoryIds = [String(rootCat._id), ...childIds];
        filterQuery['category'] = { $in: resolvedCategoryIds };
      }
    }
    
    // Get distinct values from products
    // Note: materials, colors, sizes are stored in options as strings
    // themes and collections are stored as direct references
    let [optionMaterials, optionColors, optionSizes, themes, collections] = await Promise.all([
      Product.distinct('options.materials', filterQuery),
      Product.distinct('options.colors', filterQuery),
      Product.distinct('options.sizes', filterQuery),
      Product.distinct('themes', filterQuery),
      Product.distinct('collections', filterQuery)
    ]);
    
    // Also get materials, colors, sizes from variants
    const [variantMaterials, variantColors, variantSizes] = await Promise.all([
      Product.distinct('variants.material', filterQuery),
      Product.distinct('variants.color', filterQuery),
      Product.distinct('variants.size', filterQuery)
    ]);
    
    // Debug log (comment out for production)
    // console.log('=== DEBUG FILTER VALUES ===');
    // console.log('Option materials:', optionMaterials);
    // console.log('Option colors:', optionColors);
    // console.log('Option sizes:', optionSizes);
    // console.log('Variant materials:', variantMaterials);
    // console.log('Variant colors:', variantColors);
    // console.log('Variant sizes:', variantSizes);
    
    // Merge unique values from options and variants
    const materials = [...new Set([...optionMaterials, ...variantMaterials])].filter(Boolean);
    const colors = [...new Set([...optionColors, ...variantColors])].filter(Boolean);
    const sizes = [...new Set([...optionSizes, ...variantSizes])].filter(Boolean);
    
    // If we have no materials or colors from products, return all active materials/colors from database
    if (materials.length === 0) {
      const allMaterials = await Material.find({ deleted: false }).select('_id name avatar').lean();
      console.log(`No materials in products, returning all ${allMaterials.length} materials from DB`);
      return {
        materials: allMaterials,
        colors: colors.length > 0 ? await Color.find({ name: { $in: colors }, deleted: false }) : await Color.find({ deleted: false }).select('_id name avatar').lean(),
        sizes: sizes.length > 0 ? await Size.find({ name: { $in: sizes }, deleted: false }) : [],
        themes: themes.length > 0 ? await Theme.find({ _id: { $in: themes }, deleted: false }) : [],
        collections: collections.length > 0 ? await Collection.find({ _id: { $in: collections }, deleted: false }) : [],
        price_ranges: generatePriceRanges(0, 0)
      };
    }
    
    if (colors.length === 0) {
      const allColors = await Color.find({ deleted: false }).select('_id name avatar').lean();
      console.log(`No colors in products, returning all ${allColors.length} colors from DB`);
      return {
        materials: materials.length > 0 ? await Material.find({ name: { $in: materials }, deleted: false }) : await Material.find({ deleted: false }).select('_id name avatar').lean(),
        colors: allColors,
        sizes: sizes.length > 0 ? await Size.find({ name: { $in: sizes }, deleted: false }) : [],
        themes: themes.length > 0 ? await Theme.find({ _id: { $in: themes }, deleted: false }) : [],
        collections: collections.length > 0 ? await Collection.find({ _id: { $in: collections }, deleted: false }) : [],
        price_ranges: generatePriceRanges(0, 0)
      };
    }
    
    console.log('Merged materials:', materials);
    console.log('Merged colors:', colors);
    console.log('Merged sizes:', sizes);
    
// Get price ranges for this category
    const priceStats = await Product.aggregate([
      { $match: filterQuery },
      { $unwind: '$variants' },
      {
        $group: {
          _id: null,
          minPrice: { $min: '$variants.price' },
          maxPrice: { $max: '$variants.price' }
        }
      }
    ]);
    
    // Generate price ranges based on min/max
    const priceRanges = generatePriceRanges(
      priceStats[0]?.minPrice || 0, 
      priceStats[0]?.maxPrice || 10000000
    );
    
    // Get full documents for each filter type
    const [
      materialDocs, 
      colorDocs, 
      sizeDocs, 
      themeDocs, 
      collectionDocs
    ] = await Promise.all([
      materials.length > 0 ? Material.find({ 
        $or: [
          { name: { $in: materials }, deleted: false },
          { _id: { $in: materials.filter(m => mongoose.Types.ObjectId.isValid(m)) }, deleted: false }
        ]
      }) : [],
      colors.length > 0 ? Color.find({ 
        $or: [
          { name: { $in: colors }, deleted: false },
          { _id: { $in: colors.filter(c => mongoose.Types.ObjectId.isValid(c)) }, deleted: false }
        ]
      }) : [],
      sizes.length > 0 ? Size.find({ 
        $or: [
          { name: { $in: sizes }, deleted: false },
          { _id: { $in: sizes.filter(s => mongoose.Types.ObjectId.isValid(s)) }, deleted: false }
        ]
      }) : [],
      themes.length > 0 ? Theme.find({ _id: { $in: themes }, deleted: false }) : [],
      collections.length > 0 ? Collection.find({ _id: { $in: collections }, deleted: false }) : []
    ]);
    
    // If we got no materials or colors from products, get all from database
    const finalMaterials = materialDocs.length > 0 ? materialDocs : await Material.find({ deleted: false }).select('_id name avatar').lean();
    const finalColors = colorDocs.length > 0 ? colorDocs : await Color.find({ deleted: false }).select('_id name avatar').lean();
    
    console.log(`Final materials count: ${finalMaterials.length}`);
    console.log(`Final colors count: ${finalColors.length}`);
    console.log(`Final sizes count: ${sizeDocs.length}`);
    
    return {
      materials: finalMaterials,
      colors: finalColors,
      sizes: sizeDocs,
      themes: themeDocs,
      collections: collectionDocs,
      price_ranges: priceRanges
    };
  } catch (error) {
    console.error('Error getting aggregated filters:', error);
    return {
      materials: [],
      colors: [],
      sizes: [],
      themes: [],
      collections: [],
      price_ranges: []
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