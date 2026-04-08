const router = require("express").Router();
const orderController = require("../../controllers/admin/order.controller");

router.get("/", orderController.getOrders);
router.get("/:id", orderController.getOrderById);
router.patch("/:id", orderController.updateOrder);
module.exports = router;
