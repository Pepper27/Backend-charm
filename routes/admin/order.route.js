const router = require("express").Router();
const orderController = require("../../controllers/admin/order.controller");
router.patch("/:id", orderController.updateOrder);
module.exports = router;
