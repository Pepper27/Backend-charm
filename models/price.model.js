const mongoose = require("mongoose");
slug = require('mongoose-slug-updater')
mongoose.plugin(slug)
const schema = new mongoose.Schema(
    {
        name:String,
        valueMin:Number,
        valueMax:Number,
        createdBy:String,
        updatedBy:String,
        deletedBy:String,
        deletedAt:Date,
        slug:{
            type: String, 
            slug: "name",
            unique: true
        },
        deleted:{
            type:Boolean,
            default:false
        }
    },
    {
        timestamps : true
    }
);
const Size = mongoose.model("Size",schema,"size");
module.exports = Size;
