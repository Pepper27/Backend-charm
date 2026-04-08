const router = require("express").Router();
const wishlistController = require("../../controllers/public/wishlist.controller");
const publicAuthMiddleware = require("../../middlewares/public/auth.middleware");

router.get("/", publicAuthMiddleware.requireClient, wishlistController.listWishlist);
router.post("/", publicAuthMiddleware.requireClient, wishlistController.addToWishlist);
router.delete("/:productId", publicAuthMiddleware.requireClient, wishlistController.removeFromWishlist);

module.exports = router;
