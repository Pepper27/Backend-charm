const router = require("express").Router();
const settingController = require("../../../controllers/admin/setting.controller");
const cloudinaryHelper = require("../../../helper/cloudinary.helper");
const multer = require("multer");

const upload = multer({ storage: cloudinaryHelper.storage });

router.get("/website-info", settingController.getWebsiteInfo);
router.patch(
  "/website-info",
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "favicon", maxCount: 1 },
  ]),
  settingController.updateWebsiteInfo
);

module.exports = router;
