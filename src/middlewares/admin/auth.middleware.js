const jwt = require("jsonwebtoken");
const AccountAdmin = require("../../models/accountAdmin.model");
const mongoose = require("mongoose");

module.exports.verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ").slice(1).join(" ").trim()
        : null;
    const cookieToken = req.cookies?.token;
    const token = (headerToken || cookieToken || "").trim();

    if (!token || token === "undefined" || token === "null") {
      return res.status(401).json({
        code: "error",
        message: "Token không tồn tại hoặc chưa gửi",
      });
    }

    // If Mongo is down/not connected, avoid hanging the request.
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        code: "error",
        message: "Database chưa sẵn sàng",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const existAccount = await AccountAdmin.findOne({
      email: decoded.email,
    }).maxTimeMS(5000);

    if (!existAccount) {
      return res.status(401).json({
        code: "error",
        message: "Tài khoản không hợp lệ!",
      });
    }
    req.account = existAccount;
    next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({
        code: "error",
        message: "Token hết hạn",
      });
    }
    return res.status(401).json({
      code: "error",
      message: "Token không hợp lệ",
    });
  }
};
