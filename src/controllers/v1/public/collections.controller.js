const Collection = require("../../../models/collection.model");
module.exports.list = async (req, res) => {
  try {
    const limitRaw = req.query.limit;
    const limit = limitRaw !== undefined ? Math.max(Number(limitRaw) || 0, 0) : 0;

    const hasVideo = String(req.query.hasVideo || "").trim();
    const find = { deleted: false };
    if (hasVideo === "1" || hasVideo.toLowerCase() === "true") {
      find.video = { $exists: true, $ne: null, $ne: "" };
    } else if (hasVideo === "0" || hasVideo.toLowerCase() === "false") {
      // Treat missing/empty as "no video"
      find.$or = [{ video: { $exists: false } }, { video: null }, { video: "" }];
    }

    let q = Collection.find(find).sort({ createdAt: -1 });
    if (limit > 0) q = q.limit(limit);

    const collections = await q.lean();
    res.json({ data: collections });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
