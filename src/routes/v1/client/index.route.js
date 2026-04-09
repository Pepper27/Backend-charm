const router = require("express").Router();

const { requireAuth, requireRole } = require("../../../middlewares/auth/bearer.middleware");

// Reuse existing client routes but protect with bearer.
const legacyClientOrder = require("../../legacy/client/order.route");

router.use(requireAuth, requireRole("client"));
router.use("/order", legacyClientOrder);

module.exports = router;
