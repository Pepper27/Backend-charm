const router = require("express").Router();
const catalogController = require("../../controllers/public/catalog.controller");
const mixController = require("../../controllers/public/mix.controller");
const cartController = require("../../controllers/public/cart.controller");

router.get("/bracelets", catalogController.getBracelets);
router.get("/charms", catalogController.getCharms);

router.post("/mix/validate", mixController.validateMix);

router.get("/cart", cartController.getCart);
router.post("/cart/bundles", cartController.addBundleToCart);
router.patch("/cart/bundles/:bundleId", cartController.patchBundle);
router.delete("/cart/bundles/:bundleId", cartController.deleteBundle);

module.exports = router;
