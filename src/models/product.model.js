const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);
const { Types } = require("mongoose");
const variantSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  material: String,
  color: String,
  size: String,
  price: Number,
  quantity: { type: Number, default: 0 },
  sold: { type: Number, default: 0 },
  images: [String],
});

const schema = new mongoose.Schema(
  {
    name: String,
    description: String,
    options: {
      materials: [String],
      colors: [String],
      sizes: [String],
    },
    category: { type: Types.ObjectId, ref: "Category" },
    // Pandora-style: a product can belong to multiple collections.
    collections: [{ type: Types.ObjectId, ref: "Collection" }],
    variants: [variantSchema],
    createdBy: { type: Types.ObjectId, ref: "AccountAdmin" },
    updatedBy: { type: Types.ObjectId, ref: "AccountAdmin" },
    slug: {
      type: String,
      slug: "name",
      unique: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: { type: Types.ObjectId, ref: "AccountAdmin" },
    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);

const Product = mongoose.model("Product", schema, "product");
module.exports = Product;
