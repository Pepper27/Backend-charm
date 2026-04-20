const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);
const schema = new mongoose.Schema(
  {
    name: String,
    avatar: String,
    banner: String,
    description: String,
    parent: String,
    createdBy: String,
    position: Number,
    updatedBy: String,
    deletedBy: String,
    deletedAt: Date,
    // Data-driven filter metadata used by frontend to render filter sections per-category
    // visibleFilters is an ordered array of filter keys (e.g. ["material","collection","price","theme","classification"])
    visibleFilters: { type: [String], default: [] },
    // filterOptions contains per-filter option lists, e.g. { material: ["Bạc","Vàng"], theme: [...] }
    filterOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Optional advanced per-filter configuration if needed in future
    filterConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
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
