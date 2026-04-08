const router = require("express").Router();
const productRoute = require("./product.route")
const accountAdminRouter = require("./account-admin.route")
const categoryRouter = require("./category.route")
const roleRouter = require("./role.route")
const designRouter = require("./design.route")
const clientRouter = require("./client.route")
const orderRouter = require("./order.route")
<<<<<<< HEAD
const dashboardRouter = require("./dashboard.route")
=======
const wishlistStatsRouter = require("./wishlist-stats.route")
>>>>>>> ce3ec4a7121c63be95c9d34739795722e8073b3f
const authMiddleware = require("../../middlewares/admin/auth.middleware")
router.use("/account",accountAdminRouter);
router.use("/categories",authMiddleware.verifyToken,categoryRouter)
router.use("/products",authMiddleware.verifyToken,productRoute)
router.use("/roles",authMiddleware.verifyToken,roleRouter)
router.use("/designs",authMiddleware.verifyToken,designRouter)
router.use("/clients",authMiddleware.verifyToken,clientRouter)
router.use("/order",authMiddleware.verifyToken,orderRouter)
<<<<<<< HEAD
router.use("/dashboard",authMiddleware.verifyToken,dashboardRouter)
=======
router.use("/wishlists", authMiddleware.verifyToken, wishlistStatsRouter)
>>>>>>> ce3ec4a7121c63be95c9d34739795722e8073b3f
module.exports = router
