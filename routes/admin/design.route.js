const router = require("express").Router();
const designController = require("../../controllers/admin/design.controller");

router.get("/", designController.getDesigns);
router.get("/:id", designController.getDesignById);
router.delete("/:id", designController.deleteDesignById);

module.exports = router;
