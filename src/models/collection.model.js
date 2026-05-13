const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);
const schema = new mongoose.Schema(
  {
    name: String,
    // Image shown in most places (cards, list banners)
    avatar: String,
    // Optional video used in selected placements (e.g. homepage hero/banner)
    video: String,
    // Optional poster image for video (used where we don't autoplay video)
    poster: String,
    description: String,
    createdBy: String,
    updatedBy: String,
    deletedBy: String,
    deletedAt: Date,
    slug: {
      type: String,
      slug: "name",
      unique: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);
const Collection = mongoose.model("Collection", schema, "collection");
module.exports = Collection;
