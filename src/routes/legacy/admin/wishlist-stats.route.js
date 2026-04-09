const router = require("express").Router();
const wishlistStatsController = require("../../../controllers/admin/wishlist-stats.controller");

router.get("/products", wishlistStatsController.getWishlistStatsByProduct);

module.exports = router;
