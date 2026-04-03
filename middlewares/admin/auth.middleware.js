const jwt = require("jsonwebtoken");
const AccountAdmin = require("../../models/accountAdmin.model");

module.exports.verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    const cookieToken = req.cookies?.token;
    const token = headerToken || cookieToken;

    if (!token) {
      return res.status(401).json({
        code: "error",
        message: "Token không tồn tại hoặc chưa gửi"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const existAccount = await AccountAdmin.findOne({
      email: decoded.email,
    });

    if (!existAccount) {
      return res.status(401).json({
        code: "error",
        message: "Tài khoản không hợp lệ!"
      });
    }
    req.account = existAccount;
    next();

  } catch (error) {
    return res.status(401).json({
      code: "error",
      message: "Token không hợp lệ"
    });
  }
};
