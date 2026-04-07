const mongoose = require("mongoose");
const bundleItemSchema = new mongoose.Schema(
    {
        slotIndex: Number,
        charmProductId: String,
        charmVariantCode: String,
    },
    { _id: false }
);

const bundleSchema = new mongoose.Schema(
    {
        bundleId: String,
        bracelet: {
            productId: String,
            variantCode: String,
            sizeCm: Number,
            typeCode: String,
        },
        items: [bundleItemSchema],
        rulesSnapshot: {
            slotCount: Number,
            recommendedCharms: Number,
            clipZonePercents: [Number],
        },
        priceSnapshot: {
            braceletPrice: Number,
            charmsPrice: Number,
            total: Number,
        },
        quantity: { type: Number, default: 1 },
    },
    { _id: false }
);

const schema = new mongoose.Schema({
    userId:String,
    guestId:String,
    products:[
        {
            productId:String,
            quantity:Number,
            price:Number
        }
    ],
    bundles: [bundleSchema]
},{
    timestamps:true
})
const Cart = mongoose.model("Cart",schema,"carts");
module.exports = Cart;
