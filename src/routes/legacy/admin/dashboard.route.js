const router = require("express").Router();
const dashboardController = require("../../../controllers/admin/dashboard.controller");

router.get("/", dashboardController.getDashboard);
router.get("/inventory", dashboardController.inventory);
router.post("/revenueChart", dashboardController.revenueChart);

module.exports = router;
