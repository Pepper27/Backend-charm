const router = require("express").Router();
const orderRouter = require("./order.route");

router.use("/order", orderRouter);

module.exports = router;
