const mongoose = require("mongoose");
slug = require('mongoose-slug-updater')
mongoose.plugin(slug)
const schema = new mongoose.Schema(
    {
        fullName:String,
        email:String,
        phone:String,
        role:String,
        positionCompany:String,
        status:String,
        password:String,
        avatar:String,
        createdBy:String,
        updatedBy:String,
        deletedBy:String,
        deletedAt:Date,
        slug:{
            type: String, 
            slug: "fullName",
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
const AccountAdmin = mongoose.model("AccountAdmin",schema,"account-admin");
module.exports = AccountAdmin;
