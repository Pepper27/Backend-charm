const mongoose = require("mongoose")
const orderItemSchema = new mongoose.Schema({
    productId:String,
    name:String,
    price:Number,
    quantity:Number,
    image:String

})
const schema = new mongoose.Schema({

    userId:String,
    orderCode:String,
    cart:[orderItemSchema],
    totalPrice:Number,
    status:String,
    address:String,
    phone:String
},{
    timestamps:true
})
const Order = mongoose.model("Order",schema,"orders")
module.exports = Order