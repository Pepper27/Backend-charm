const router = require("express").Router();
const roleController = require("../../../controllers/admin/role.controller");
router.get("/", roleController.getRoles);
router.get("/:id", roleController.getRolesById);
router.post("/", roleController.roleCreate);
router.patch("/:id", roleController.roleUpdate);
router.delete("/:id", roleController.roleDelete);

module.exports = router;
