const Collection = require("../../../models/collection.model");
module.exports.list = async (req, res) => {
  try {
    const collections = await Collection.find({ deleted: false })
    res.json({ data: collections });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};