const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);
const schema = new mongoose.Schema(
  {
    name: String,
    content: String,
    avatar: String,
    createdBy: String,
    updatedBy: String,
    slug: {
      type: String,
      slug: "name",
      unique: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: String,
    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);
const New = mongoose.model("New", schema, "news");
module.exports = New;
