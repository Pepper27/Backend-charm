const express = require('express');
const Product = require('../../models/product.model');
const router = express.Router();

// Debug endpoint to compare admin vs public API results
router.get('/debug/products', async (req, res) => {
  try {
    // Count all products (admin view)
    const adminCount = await Product.countDocuments({ deleted: false });
    
    // Get all products (admin view)
    const adminProducts = await Product.find({ deleted: false })
      .select('name slug variants priceMin priceMax category')
      .lean();
    
    // Get products through public API logic
    const publicCount = await Product.countDocuments({ deleted: false });
    
    // Return comparison
    res.json({
      admin: {
        count: adminCount,
        products: adminProducts.slice(0, 10).map(p => ({
          id: p._id,
          name: p.name,
          slug: p.slug,
          priceMin: p.priceMin,
          priceMax: p.priceMax,
          category: p.category,
          variantCount: p.variants?.length || 0
        }))
      },
      public: {
        count: publicCount
      },
      difference: {
        count: adminCount - publicCount
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = router;