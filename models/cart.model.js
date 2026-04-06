const mongoose = require("mongoose");
const { Types } = require("mongoose")
const schema = new mongoose.Schema({
    userId: {
      type: Types.ObjectId,
      ref: "AccountClient"
    },
    products:[
        {
            productId: {
              type: Types.ObjectId,
              ref: "Product"
            },
            variantId:String,
            quantity:Number,
            price:Number
        }
    ]
},{
    timestamps:true
})
const Cart = mongoose.model("Cart",schema,"carts");
module.exports = Cart;
