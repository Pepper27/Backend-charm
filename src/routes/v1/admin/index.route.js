const router = require("express").Router();

const { requireAuth, requireRole } = require("../../../middlewares/auth/bearer.middleware");
const adminAuthController = require("../../../controllers/v1/admin/auth.controller");

// Auth
router.post("/auth/login", adminAuthController.login);

// Legacy admin routers, protected by bearer for v1.
// We reuse existing route handlers to minimize changes.
const legacyCategories = require("../../legacy/admin/category.route");
const legacyProducts = require("../../legacy/admin/product.route");
const legacyCollections = require("../../legacy/admin/collection.route");
const legacyRoles = require("../../legacy/admin/role.route");
const legacyDesigns = require("../../legacy/admin/design.route");
const legacyClients = require("../../legacy/admin/client.route");
const legacyOrders = require("../../legacy/admin/order.route");
const legacyWishlistStats = require("../../legacy/admin/wishlist-stats.route");
const legacyDashboard = require("../../legacy/admin/dashboard.route");
// Thêm vào cùng nhóm với legacyCategories, legacyProducts...
const legacyMaterials = require("../../legacy/admin/material.route");
const legacyColors = require("../../legacy/admin/color.route");
const legacySizes = require("../../legacy/admin/size.route");

router.use(requireAuth, requireRole("admin"));

router.use("/categories", legacyCategories);
router.use("/products", legacyProducts);
router.use("/collections", legacyCollections);
router.use("/roles", legacyRoles);
router.use("/designs", legacyDesigns);
router.use("/clients", legacyClients);
router.use("/order", legacyOrders);
router.use("/wishlists", legacyWishlistStats);
router.use("/dashboard", legacyDashboard);
router.use("/materials", legacyMaterials);
router.use("/colors", legacyColors);
router.use("/sizes", legacySizes);

// Minimal refund job management (v1)
const refundController = require("../../../controllers/v1/admin/refund.controller");
router.get("/refunds", refundController.list);
router.post("/refunds/:id/retry", refundController.retry);
router.patch("/refunds/:id/manual", refundController.manual);


module.exports = router;
