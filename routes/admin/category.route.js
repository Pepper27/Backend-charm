const router = require("express").Router()
const categoryController = require("../../controllers/admin/category.controller")
const multer = require("multer")
const cloudinaryHelper = require("../../helper/cloudinary.helper")
const upload = multer({
    storage:cloudinaryHelper.storage
})
router.post("/", upload.single('avatar'),categoryController.createPost);
router.get("/",categoryController.getCategories);
router.get("/parent",categoryController.getCategoriesParent);
router.get("/:id",categoryController.getCategoryById)
router.patch("/:id",upload.single('avatar'),categoryController.updateCategoryById)
// router.delete("/:id",productController.deleteProduct)
module.exports = router