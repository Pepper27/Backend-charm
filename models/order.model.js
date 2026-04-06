const mongoose = require("mongoose")
const { Types } = require("mongoose")
const orderItemSchema = new mongoose.Schema({
    productId: {
      type: Types.ObjectId,
      ref: "Product"
    },
    variantId:String,
    name:String,
    price:Number,
    quantity:Number,
    image:String
})
const schema = new mongoose.Schema({

    userId: {
      type: Types.ObjectId,
      ref: "AccountClient"
    },
    orderCode:String,
    cart:[orderItemSchema],
    totalPrice:Number,
    status:{
        type:String,
        enum:["pending","confirmed","shipping","delivered","cancelled"],
        default:"pending"
    },
    method:{
        type:String,
        enum:["cash","zalopay"],
        default:"cash"
    },
    payStatus:{
        type:String,
        enum:["unpaid","paid"],
        default:"unpaid"
    },
    address:String,
    phone:String,
    updatedBy:String,
    deletedBy:String,
    deletedAt:Date,
    checkStatus:{
        type:Boolean,
        default:false
    },
    deleted:{
        type:Boolean,
        default:false
    }
},{
    timestamps:true
})
const Order = mongoose.model("Order",schema,"orders")
module.exports = Order