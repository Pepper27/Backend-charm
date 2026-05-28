const { generateAreasFromPreview } = require("../src/lib/engraving-area-detector");

const url =
  process.argv[2] ||
  "https://res.cloudinary.com/docesrb1s/image/upload/v1779856631/category/jz98jbkgoc0ei234wbzo.png";

(async () => {
  try {
    console.log("Testing detector for", url);
    const areas = await generateAreasFromPreview(url);
    console.log("Detected areas:", JSON.stringify(areas, null, 2));
  } catch (e) {
    console.error("Detector error:", e && (e.message || e));
    process.exit(1);
  }
})();
