const mongoose = require("mongoose");
const schema = new mongoose.Schema({
    userId:String,
    products:[
        {
            productId:String,
            quantity:Number,
            price:Number
        }
    ]
},{
    timestamps:true
})
const Cart = mongoose.model("Cart",schema,"carts");
module.exports = Cart;
