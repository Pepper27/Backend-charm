const router = require("express").Router();
const collectionController = require("../../../controllers/admin/collection.controller");
const multer = require("multer");
const cloudinaryHelper = require("../../../helper/cloudinary.helper");

const upload = multer({
  storage: cloudinaryHelper.storage,
});

router.post("/", upload.single("avatar"), collectionController.createCollection);
router.get("/", collectionController.getCollections);
router.get("/:id", collectionController.getCollectionById);
router.patch("/:id", upload.single("avatar"), collectionController.updateCollectionById);
router.delete("/:id", collectionController.deleteCollectionById);

module.exports = router;
