const mongoose = require("mongoose");
// Fail fast instead of buffering queries (prevents requests from "hanging").
mongoose.set("bufferCommands", false);

module.exports.connectDB = async () => {
  try {
    const uri = process.env.DATABASE;
    if (!uri) {
      throw new Error("Missing DATABASE env");
    }

    await mongoose.connect(uri, {
      // If Mongo is unreachable, error quickly instead of hanging.
      serverSelectionTimeoutMS: 10_000,
    });

    console.log("Kết nối thành công");
  } catch (error) {
    console.error(error);
    console.log("Kết nối thất bại");
    throw error;
  }
};
