const router = require("express").Router();
const catalogController = require("../../../controllers/public/catalog.controller");
const mixController = require("../../../controllers/public/mix.controller");
const cartController = require("../../../controllers/public/cart.controller");
const designController = require("../../../controllers/public/design.controller");
const authController = require("../../../controllers/public/auth.controller");
const categoryController = require("../../../controllers/public/category.controller");
const publicAuthMiddleware = require("../../../middlewares/public/auth.middleware");
const wishlistRouter = require("./wishlist.route");

// Attach client identity when token is present.
router.use(publicAuthMiddleware.attachClient);

router.get("/bracelets", catalogController.getBracelets);
router.get("/charms", catalogController.getCharms);

router.get("/categories", categoryController.getCategories);

router.post("/mix/validate", mixController.validateMix);

router.get("/cart", cartController.getCart);
router.post("/cart/bundles", cartController.addBundleToCart);
router.patch("/cart/bundles/:bundleId", cartController.patchBundle);
router.delete("/cart/bundles/:bundleId", cartController.deleteBundle);

router.get("/designs", designController.listDesigns);
router.post("/designs", designController.saveDesignAndAddToCart);
router.delete("/designs/:designId", designController.deleteDesign);

// Wishlist (requires client login)
router.use("/wishlist", wishlistRouter);

// Client auth
router.post("/auth/register", authController.register);
router.post("/auth/login", authController.login);
router.get("/auth/me", authController.me);
router.post("/auth/logout", authController.logout);
router.post("/auth/forgot-password", authController.forgotPassword);
router.post("/auth/reset-password", authController.resetPassword);

module.exports = router;
