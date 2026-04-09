const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);
const schema = new mongoose.Schema(
  {
    name: String,
    avatar: String,
    description: String,
    parent: String,
    createdBy: String,
    position: Number,
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
const Category = mongoose.model("Category", schema, "category");
module.exports = Category;
