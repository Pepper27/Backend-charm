const router = require("express").Router();

// Legacy (non-versioned) routes
router.use("/admin", require("./legacy/admin/index.route"));
router.use("/public", require("./legacy/public/index.route"));
router.use("/client", require("./legacy/client/index.route"));

// Versioned API routes
router.use("/v1", require("./v1/index.route"));

module.exports = router;
