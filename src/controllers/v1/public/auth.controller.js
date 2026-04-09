const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const AccountClient = require("../../../models/accountClient.model");
const v1 = require("../../../helper/v1-response.helper");

// POST /api/v1/public/auth/login
module.exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const safeEmail = String(email || "")
      .trim()
      .toLowerCase();

    const user = await AccountClient.findOne({ email: safeEmail, deleted: false });
    if (!user) {
      return v1.fail(res, 400, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng");
    }

    const ok = await bcrypt.compare(String(password || ""), user.password || "");
    if (!ok) {
      return v1.fail(res, 400, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng");
    }

    const accessToken = jwt.sign(
      { id: user._id, email: user.email, role: "client" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return v1.ok(res, {
      accessToken,
      user: { id: String(user._id), fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    return v1.serverError(res, error);
  }
};

// GET /api/v1/public/auth/me (requires bearer)
module.exports.me = async (req, res) => {
  try {
    if (!req.auth?.id || req.auth.role !== "client") {
      return v1.ok(res, null);
    }
    const user = await AccountClient.findOne({ _id: req.auth.id, deleted: false })
      .select("fullName email phone")
      .lean();
    return v1.ok(res, user ? { id: String(user._id), ...user } : null);
  } catch (error) {
    return v1.serverError(res, error);
  }
};
