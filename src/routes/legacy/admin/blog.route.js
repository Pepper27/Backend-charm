const router = require("express").Router();
const blogController = require("../../../controllers/admin/blog.controller");
const multer = require("multer");
const cloudinaryHelper = require("../../../helper/cloudinary.helper");

const upload = multer({
  storage: cloudinaryHelper.storage,
});

router.post("/", upload.single("avatar"), blogController.createBlog);
router.get("/", blogController.getBlogs);
router.get("/:id", blogController.getBlogById);
router.patch("/:id", upload.single("avatar"), blogController.updateBlogById);
router.delete("/:id", blogController.deleteBlogById);

module.exports = router;
