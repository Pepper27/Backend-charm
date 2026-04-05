const router = require("express").Router()
const productController = require("../../controllers/admin/product.controller");
const multer = require("multer")
const cloudinaryHelper = require("../../helper/cloudinary.helper")
const upload = multer({
    storage:cloudinaryHelper.storage
})
router.post("/",upload.any(),productController.createProduct);
router.get("/",productController.getProducts);
router.get("/:id",productController.getProductById);
router.patch("/:id",productController.updateProduct)
// router.delete("/:id",productController.deleteProduct)
module.exports = router;