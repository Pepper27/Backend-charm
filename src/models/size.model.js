const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);
const schema = new mongoose.Schema(
  {
    name: String,
    category:String,
    unit: String, 
    value: String,
    createdBy: String,
    updatedBy: String,
    deletedBy: String,
    deletedAt: Date,
    description: String,
    slug: {
      type: String,
      slug: "name",
      unique: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    isActive:{
      type: Boolean,
      default: false,
    }
  },
  {
    timestamps: true,
  }
);
const Size = mongoose.model("Size", schema, "size");
module.exports = Size;
