const router = require("express").Router();
const clientController = require("../../../controllers/admin/client.controller");

router.get("/", clientController.getClients);
router.get("/:id", clientController.getClientById);
router.delete("/:id", clientController.deleteClient);

module.exports = router;
