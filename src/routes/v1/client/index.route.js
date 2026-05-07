const router = require("express").Router();

const { requireAuth, requireRole } = require("../../../middlewares/auth/bearer.middleware");

const ordersController = require("../../../controllers/v1/client/orders.controller");

router.use(requireAuth, requireRole("client"));

router.get("/orders/stats", ordersController.stats);
router.get("/orders", ordersController.list);
router.get("/orders/:orderCode", ordersController.getByCode);
router.post("/orders/:orderCode/cancel", ordersController.cancel);

module.exports = router;
