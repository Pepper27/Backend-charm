const router = require("express").Router();
const productController = require("../../controllers/admin/product.controller");
router.get("/",productController.getProducts);
router.post("/",productController.createProduct);
router.get("/:id",productController.getProductById)
router.patch("/:id",productController.updateProduct)
router.delete("/:id",productController.deleteProduct)
module.exports = router;