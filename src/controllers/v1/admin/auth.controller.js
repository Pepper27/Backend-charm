const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const AccountAdmin = require("../../../models/accountAdmin.model");
const v1 = require("../../../helper/v1-response.helper");

// POST /api/v1/admin/auth/login
module.exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const safeEmail = String(email || "")
      .trim()
      .toLowerCase();

    const user = await AccountAdmin.findOne({ email: safeEmail, deleted: false });
    if (!user) {
      return v1.fail(res, 400, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng");
    }
    if (user.status === "initial") {
      return v1.fail(res, 403, "NOT_APPROVED", "Tài khoản chưa được phê duyệt");
    }

    const ok = await bcrypt.compare(String(password || ""), user.password || "");
    if (!ok) {
      return v1.fail(res, 400, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng");
    }

    const accessToken = jwt.sign(
      { id: user._id, email: user.email, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return v1.ok(res, {
      accessToken,
      admin: { id: String(user._id), fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    return v1.serverError(res, error);
  }
};
