// Mix builder category slug configuration.
// Supports both the "bracelet/charm/clip" convention and existing VN slugs.

const braceletRootSlugs = ["bracelet", "vong-tay"];
const charmRootSlugs = ["charm", "charm-zBoaPLB6r"];

// "clip" charms: default spec uses slug `clip`.
// In the current dataset, "Charm chan" appears under slug `charm-chan`.
const clipSlugs = ["clip", "charm-chan"];

// Allow FE to query by canonical typeCode while DB uses different slugs.
// validate/cart flows do NOT accept typeCode from FE, they infer from product.category.
const braceletTypeAliases = {
  "snake-chain": ["snake-chain", "vong-tay-mem"],
  bangle: ["bangle", "vong-kieng"],
  leather: ["leather", "vong-da", "vong-da-U2oezSEXV"],
};

module.exports = {
  braceletRootSlugs,
  charmRootSlugs,
  clipSlugs,
  braceletTypeAliases,
};
