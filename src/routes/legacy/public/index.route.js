const router = require("express").Router();
const catalogController = require("../../../controllers/public/catalog.controller");
const mixController = require("../../../controllers/public/mix.controller");
const cartController = require("../../../controllers/public/cart.controller");
const designController = require("../../../controllers/public/design.controller");
const authController = require("../../../controllers/public/auth.controller");
const categoryController = require("../../../controllers/public/category.controller");
const publicAuthMiddleware = require("../../../middlewares/public/auth.middleware");
const checkoutController = require("../../../controllers/public/checkout.controller");
const zaloController = require("../../../controllers/public/zalo.controller");
const wishlistRouter = require("./wishlist.route");

// Attach client identity when token is present.
router.use(publicAuthMiddleware.attachClient);

router.get("/bracelets", catalogController.getBracelets);
router.get("/charms", catalogController.getCharms);

router.get("/categories", categoryController.getCategories);

router.post("/mix/validate", mixController.validateMix);

// Bundle-centric checkout (guest + logged-in).
router.post("/checkout", checkoutController.checkoutBundles);

// ZaloPay webhook (server-to-server)
router.post("/zalopay/webhook", zaloController.webhook);
// Client redirect confirmation (frontend may call this after returning from provider)
router.post("/zalopay/confirm", zaloController.confirm);

// Guest/client order tracking (by phone/email) and order detail.
router.get("/orders/lookup", checkoutController.lookupOrders);
router.get("/orders/:orderCode", checkoutController.getOrderByCode);
router.post("/orders/email", checkoutController.emailOrders);

router.get("/cart", cartController.getCart);
router.post("/cart/bundles", cartController.addBundleToCart);
router.patch("/cart/bundles/:bundleId", cartController.patchBundle);
router.delete("/cart/bundles/:bundleId", cartController.deleteBundle);
// Product-level cart API: add a normal product line to cart.products
router.post("/cart/products", cartController.addProductToCart);
router.patch("/cart/products/:lineId", cartController.patchProduct);
router.delete("/cart/products/:lineId", cartController.deleteProduct);

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
