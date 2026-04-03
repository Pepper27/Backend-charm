const mongoose = require("mongoose");
slug = require('mongoose-slug-updater')
mongoose.plugin(slug)
const schema = new mongoose.Schema(
    {
        name:String,
        avatar:String,
        description:String,
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
const Theme = mongoose.model("Theme",schema,"theme");
module.exports = Theme;
