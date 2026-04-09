const router = require("express").Router();

router.use("/public", require("./public/index.route"));
router.use("/admin", require("./admin/index.route"));
router.use("/client", require("./client/index.route"));

module.exports = router;
