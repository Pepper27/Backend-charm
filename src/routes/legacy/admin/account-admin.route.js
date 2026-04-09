const router = require("express").Router();
const accountAdminController = require("../../../controllers/admin/account-admin.controller");
const authMiddleware = require("../../../middlewares/admin/auth.middleware");
const cloudinaryHeleper = require("../../../helper/cloudinary.helper");
var multer = require("multer");
const upload = multer({ storage: cloudinaryHeleper.storage });
router.post("/login", accountAdminController.loginPost);
// router.post("/register",accountAdminController.registerPost);
router.post("/forgot-password", accountAdminController.forgotPasswordPost);
router.post("/otp-password", accountAdminController.otpPasswordPost);
router.post(
  "/reset-password",
  authMiddleware.verifyToken,
  accountAdminController.resetPasswordPost
);
router.post("/logout", accountAdminController.logoutPost);
router.get("/user", authMiddleware.verifyToken, accountAdminController.getName);

router.get("/", authMiddleware.verifyToken, accountAdminController.getAccountAdmins);
router.get("/:id", authMiddleware.verifyToken, accountAdminController.getAccountAdminsById);
router.post(
  "/",
  upload.single("avatar"),
  authMiddleware.verifyToken,
  accountAdminController.accountAdminCreate
);
router.patch(
  "/:id",
  upload.single("avatar"),
  authMiddleware.verifyToken,
  accountAdminController.accountAdminUpdate
);
router.delete("/:id", authMiddleware.verifyToken, accountAdminController.accountAdminDelete);
module.exports = router;
