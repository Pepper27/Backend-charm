const router = require("express").Router();
const collectionController = require("../../../controllers/admin/collection.controller");
const multer = require("multer");
const cloudinaryHelper = require("../../../helper/cloudinary.helper");

const upload = multer({
  storage: cloudinaryHelper.collectionStorage,
});

router.post(
  "/",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "video", maxCount: 1 },
    { name: "poster", maxCount: 1 },
  ]),
  collectionController.createCollection
);
router.get("/", collectionController.getCollections);
router.get("/:id", collectionController.getCollectionById);
router.patch(
  "/:id",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "video", maxCount: 1 },
    { name: "poster", maxCount: 1 },
  ]),
  collectionController.updateCollectionById
);
router.delete("/:id", collectionController.deleteCollectionById);

module.exports = router;
