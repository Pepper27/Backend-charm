const router = require("express").Router();
const productRoute = require("./product.route")
const accountAdminRouter = require("./account-admin.route")
const categoryRouter = require("./category.route")
const roleRouter = require("./role.route")
const authMiddleware = require("../../middlewares/admin/auth.middleware")
router.use("/account",accountAdminRouter);
router.use("/categories",authMiddleware.verifyToken,categoryRouter)
router.use("/products",authMiddleware.verifyToken,productRoute)
router.use("/roles",authMiddleware.verifyToken,roleRouter)
module.exports = router
