const mongoose = require('mongoose');
module.exports.connectDB = ()=>{
    try {
        mongoose.connect(process.env.DATABASE);
        console.log("Kết nối thành công");
    } catch (error) {
        console.log(error);
        console.log("Kết nối thất bại")
    }
}
