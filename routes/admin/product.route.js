const router = require("express").Router();
const multer = require("multer")
const cloudinaryHelper = require("../../helper/cloudinary.helper")
const upload = multer({
    storage:cloudinaryHelper.storage
})
const productController = require("../../controllers/admin/product.controller");
router.get("/",productController.getProducts);
router.post("/",upload.any(),productController.createProduct);
router.get("/:id",productController.getProductById)
router.patch("/:id",productController.updateProduct)
router.delete("/:id",productController.deleteProduct)
module.exports = router;