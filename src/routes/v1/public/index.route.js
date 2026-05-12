const router = require("express").Router();

const categoriesController = require("../../../controllers/v1/public/categories.controller");
const productsController = require("../../../controllers/v1/public/products.controller");
const authController = require("../../../controllers/v1/public/auth.controller");
const collectionsController = require("../../../controllers/v1/public/collections.controller");
const { requireAuth } = require("../../../middlewares/auth/bearer.middleware");

router.get("/categories", categoriesController.list);
router.get("/collections", collectionsController.list);
router.get("/products", productsController.list);
router.get("/products/collection/:collectionId", productsController.list);
router.get("/products/best-sellers", productsController.getBestSellers);
router.get("/products/:id", productsController.getById);
router.get("/products/slug/:slug", productsController.getBySlug);

router.post("/auth/login", authController.login);
router.get("/auth/me", requireAuth, authController.me);

module.exports = router;
