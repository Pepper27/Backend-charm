const mongoose = require("mongoose")
const slug = require('mongoose-slug-updater')
mongoose.plugin(slug)

const variantSchema = new mongoose.Schema({
    sku: { type: String, unique: true },

    material: String,   
    color: String,      
    size: String,   

    price: Number,      
    quantity: { type: Number, default: 0 },
    sold: { type: Number, default: 0 },

    images: [String]
})

const schema = new mongoose.Schema({
    name: String,
    description: String,
    basePrice: Number,
    options: {
        materials: [String],
        colors: [String],
        sizes: [String]
    },
    variants: [variantSchema],
    createdBy: String,
    updatedBy: String,
    slug: {   
        type: String, 
        slug: "name",
        unique: true
    },
    deleted: {
        type: Boolean,
        default: false
    },
    deletedBy: String,
    deletedAt: Date
}, {
    timestamps: true
})

const Product = mongoose.model("Product", schema, "product")
module.exports = Product