const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AccountClient = require("../../models/accountClient.model");
const Cart = require("../../models/cart.model");
const Design = require("../../models/design.model");
const ForgotPassword = require("../../models/forgotPassword.model");
const mailHelper = require("../../helper/mailer.helper");
const randomOtp = require("../../helper/generate.helper");
const { ensureGuestIdCookie } = require("../../helper/guest.helper");

const setClientTokenCookie = (req, res, token) => {
  const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
  res.cookie("clientToken", token, {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  });
};

const clearClientTokenCookie = (req, res) => {
  const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
  res.clearCookie("clientToken", {
    httpOnly: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  });
};

const mergeGuestToUser = async ({ guestId, userId }) => {
  // Merge cart: if user already has cart -> append guest bundles, then delete guest cart.
  const [guestCart, userCart] = await Promise.all([
    Cart.findOne({ guestId }).lean(),
    Cart.findOne({ userId: String(userId) }).lean(),
  ]);

  if (guestCart && userCart) {
    const guestBundles = Array.isArray(guestCart.bundles) ? guestCart.bundles : [];
    if (guestBundles.length) {
      await Cart.updateOne({ userId: String(userId) }, { $push: { bundles: { $each: guestBundles } } });
    }
    await Cart.deleteOne({ guestId });
  } else if (guestCart && !userCart) {
    await Cart.updateOne({ guestId }, { $set: { userId: String(userId) }, $unset: { guestId: "" } });
  }

  // Attach userId to all guest designs.
  await Design.updateMany({ guestId, userId: null }, { $set: { userId: new mongoose.Types.ObjectId(userId) } });
};

module.exports.register = async (req, res) => {
  try {
    const { fullName, email, password, phone } = req.body || {};
    const safeEmail = String(email || "").trim().toLowerCase();
    const safeName = String(fullName || "").trim();
    const safePhone = String(phone || "").trim();

    if (!safeEmail || !safeEmail.includes("@")) {
      return res.status(400).json({ code: "error", message: "Email không hợp lệ" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ code: "error", message: "Mật khẩu tối thiểu 6 ký tự" });
    }

    const exists = await AccountClient.findOne({ email: safeEmail, deleted: false }).lean();
    if (exists) {
      return res.status(400).json({ code: "error", message: "Email đã tồn tại" });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(String(password), salt);
    const user = await AccountClient.create({
      fullName: safeName,
      email: safeEmail,
      phone: safePhone,
      password: hash,
      deleted: false,
    });

    return res.status(201).json({
      code: "success",
      message: "Đăng ký thành công",
      data: { id: user._id, fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};

module.exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const guestId = ensureGuestIdCookie(req, res);
    const safeEmail = String(email || "").trim().toLowerCase();

    const user = await AccountClient.findOne({ email: safeEmail, deleted: false });
    if (!user) {
      return res.status(400).json({ code: "error", message: "Email không tồn tại" });
    }

    const ok = await bcrypt.compare(String(password || ""), user.password || "");
    if (!ok) {
      return res.status(400).json({ code: "error", message: "Mật khẩu không đúng" });
    }

    await mergeGuestToUser({ guestId, userId: user._id });

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    setClientTokenCookie(req, res, token);

    return res.status(200).json({
      code: "success",
      message: "Đăng nhập thành công",
      token,
      data: { id: user._id, fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};

module.exports.me = async (req, res) => {
  if (!req.client) {
    return res.status(200).json({ data: null });
  }
  return res.status(200).json({
    data: { id: req.client._id, fullName: req.client.fullName, email: req.client.email },
  });
};

module.exports.logout = async (req, res) => {
  clearClientTokenCookie(req, res);
  return res.status(200).json({ code: "success", message: "Đăng xuất thành công" });
};

module.exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};
    const safeEmail = String(email || "").trim().toLowerCase();

    const user = await AccountClient.findOne({ email: safeEmail, deleted: false }).lean();
    if (!user) {
      return res.status(400).json({ code: "error", message: "Email không tồn tại" });
    }

    const existOtp = await ForgotPassword.findOne({ email: safeEmail }).lean();
    if (existOtp) {
      return res.status(400).json({ code: "error", message: "OTP đã được gửi, vui lòng đợi" });
    }

    const otp = randomOtp.RandomNumber(6);
    await ForgotPassword.create({
      email: safeEmail,
      otp,
      expireAt: Date.now() + 3 * 60 * 1000,
    });

    const subject = "Mã OTP đổi mật khẩu";
    const content = `<span>Mã OTP của bạn: </span><b style="color:green">${otp}</b><span> Vui lòng không chia sẻ cho bất kỳ ai.</span>`;
    mailHelper.sendMail(safeEmail, subject, content);

    return res.status(200).json({ code: "success", message: "Gửi OTP thành công" });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};

module.exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    const safeEmail = String(email || "").trim().toLowerCase();
    const safeOtp = String(otp || "").trim();

    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ code: "error", message: "Mật khẩu tối thiểu 6 ký tự" });
    }

    const record = await ForgotPassword.findOne({ email: safeEmail, otp: safeOtp });
    if (!record) {
      return res.status(400).json({ code: "error", message: "OTP không đúng hoặc đã hết hạn" });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(String(newPassword), salt);
    await AccountClient.updateOne({ email: safeEmail, deleted: false }, { $set: { password: hash } });
    await ForgotPassword.deleteMany({ email: safeEmail });

    return res.status(200).json({ code: "success", message: "Đổi mật khẩu thành công" });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};
