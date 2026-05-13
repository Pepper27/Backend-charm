const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AccountClient = require("../../models/accountClient.model");
const Cart = require("../../models/cart.model");
const Design = require("../../models/design.model");
const ForgotPassword = require("../../models/forgotPassword.model");
const mailHelper = require("../../helper/mailer.helper");
const generateHelper = require("../../helper/generate.helper");
const { ensureGuestIdCookie } = require("../../helper/guest.helper");

const isValidEmail = (email) => {
  const s = String(email || "")
    .trim()
    .toLowerCase();
  // pragmatic check; good enough for client signup/login.
  return !!(s && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
};

const normalizePhone = (phone) => {
  let s = String(phone || "").trim();
  if (!s) return "";
  // keep digits only
  s = s.replace(/[^0-9+]/g, "");
  if (s.startsWith("+84")) s = "0" + s.slice(3);
  // remove any leading +
  s = s.replace(/\+/g, "");
  return s;
};

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
};

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
      await Cart.updateOne(
        { userId: String(userId) },
        { $push: { bundles: { $each: guestBundles } } }
      );
    }
    await Cart.deleteOne({ guestId });
  } else if (guestCart && !userCart) {
    await Cart.updateOne(
      { guestId },
      { $set: { userId: String(userId) }, $unset: { guestId: "" } }
    );
  }

  // Attach userId to all guest designs.
  await Design.updateMany(
    { guestId, userId: null },
    { $set: { userId: new mongoose.Types.ObjectId(userId) } }
  );
};

module.exports.register = async (req, res) => {
  try {
    const { fullName, email, password, phone } = req.body || {};
    const safeEmail = String(email || "")
      .trim()
      .toLowerCase();
    const safeName = String(fullName || "").trim();
    const safePhone = normalizePhone(phone);

    if (!safeName || safeName.length < 2 || safeName.length > 80) {
      return res.status(400).json({ code: "error", message: "Họ và tên không hợp lệ" });
    }
    if (!isValidEmail(safeEmail)) {
      return res.status(400).json({ code: "error", message: "Email không hợp lệ" });
    }
    if (!safePhone) {
      return res.status(400).json({ code: "error", message: "Số điện thoại là bắt buộc" });
    }
    if (!/^(0\d{8,10})$/.test(safePhone)) {
      return res.status(400).json({ code: "error", message: "Số điện thoại không hợp lệ" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ code: "error", message: "Mật khẩu tối thiểu 6 ký tự" });
    }

    const exists = await AccountClient.findOne({ email: safeEmail, deleted: false }).lean();
    if (exists) {
      return res.status(400).json({ code: "error", message: "Email đã tồn tại" });
    }

    const existsPhone = await AccountClient.findOne({ phone: safePhone, deleted: false }).lean();
    if (existsPhone) {
      return res.status(400).json({ code: "error", message: "Số điện thoại đã tồn tại" });
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
    const safeEmail = String(email || "")
      .trim()
      .toLowerCase();

    const user = await AccountClient.findOne({ email: safeEmail, deleted: false });
    if (!user) {
      return res.status(400).json({ code: "error", message: "Email không tồn tại" });
    }

    const ok = await bcrypt.compare(String(password || ""), user.password || "");
    if (!ok) {
      return res.status(400).json({ code: "error", message: "Mật khẩu không đúng" });
    }

    await mergeGuestToUser({ guestId, userId: user._id });

    // Include role so the same token can be used for v1 bearer endpoints.
    const token = jwt.sign(
      { id: user._id, email: user.email, role: "client" },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
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
    const safeEmail = String(email || "")
      .trim()
      .toLowerCase();

    if (!isValidEmail(safeEmail)) {
      return res.status(400).json({ code: "error", message: "Email không hợp lệ" });
    }

    const user = await AccountClient.findOne({ email: safeEmail, deleted: false }).lean();
    if (!user) {
      return res.status(400).json({ code: "error", message: "Email không tồn tại" });
    }

    const now = new Date();
    const existOtp = await ForgotPassword.findOne({ email: safeEmail }).lean();
    if (existOtp && existOtp.expireAt && new Date(existOtp.expireAt) > now) {
      const waitMs = new Date(existOtp.expireAt).getTime() - now.getTime();
      const waitSec = Math.max(1, Math.ceil(waitMs / 1000));
      return res
        .status(400)
        .json({ code: "error", message: `OTP đã được gửi, vui lòng đợi ${waitSec}s` });
    }
    if (existOtp) {
      // TTL cleanup in Mongo is not immediate; remove stale record so user can re-request.
      await ForgotPassword.deleteMany({ email: safeEmail });
    }

    const otp = generateHelper.generateRandomNumber(6);
    await ForgotPassword.create({
      email: safeEmail,
      otp,
      expireAt: new Date(Date.now() + 3 * 60 * 1000),
    });

    const subject = "Mã OTP đổi mật khẩu";
    const content = `<span>Mã OTP của bạn: </span><b style="color:green">${otp}</b><span> Vui lòng không chia sẻ cho bất kỳ ai.</span>`;
    const mailInfo = await mailHelper.sendMail(safeEmail, subject, content);
    if (!mailInfo) {
      // Don't keep OTP if we couldn't email it.
      await ForgotPassword.deleteMany({ email: safeEmail });
      return res.status(500).json({
        code: "error",
        message: "Không gửi được email OTP. Vui lòng kiểm tra cấu hình email server.",
      });
    }

    return res.status(200).json({ code: "success", message: "Gửi OTP thành công" });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};

module.exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    const safeEmail = String(email || "")
      .trim()
      .toLowerCase();
    const safeOtp = String(otp || "").trim();

    if (!isValidEmail(safeEmail)) {
      return res.status(400).json({ code: "error", message: "Email không hợp lệ" });
    }
    if (!safeOtp) {
      return res.status(400).json({ code: "error", message: "OTP là bắt buộc" });
    }

    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ code: "error", message: "Mật khẩu tối thiểu 6 ký tự" });
    }

    const record = await ForgotPassword.findOne({
      email: safeEmail,
      otp: safeOtp,
      expireAt: { $gt: new Date() },
    });
    if (!record) {
      return res.status(400).json({ code: "error", message: "OTP không đúng hoặc đã hết hạn" });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(String(newPassword), salt);
    await AccountClient.updateOne(
      { email: safeEmail, deleted: false },
      { $set: { password: hash } }
    );
    await ForgotPassword.deleteMany({ email: safeEmail });

    return res.status(200).json({ code: "success", message: "Đổi mật khẩu thành công" });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};

module.exports.oauthGoogle = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { accessToken, idToken } = req.body || {};
    const safeAccessToken = String(accessToken || "").trim();
    const safeIdToken = String(idToken || "").trim();

    if (!safeAccessToken && !safeIdToken) {
      return res.status(400).json({ code: "error", message: "Thiếu token Google" });
    }

    let profile = null;
    if (safeAccessToken) {
      const r = await fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${safeAccessToken}` },
      });
      if (!r.ok) {
        return res.status(400).json({ code: "error", message: "Token Google không hợp lệ" });
      }
      profile = r.data;
    } else {
      const r = await fetchJson(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(safeIdToken)}`
      );
      if (!r.ok) {
        return res.status(400).json({ code: "error", message: "Token Google không hợp lệ" });
      }
      // tokeninfo returns slightly different keys
      profile = {
        sub: r.data && (r.data.sub || r.data.user_id),
        email: r.data && r.data.email,
        name: r.data && r.data.name,
        picture: r.data && r.data.picture,
        aud: r.data && r.data.aud,
      };
    }

    const googleId = String(profile?.sub || "").trim();
    const email = String(profile?.email || "")
      .trim()
      .toLowerCase();
    const fullName = String(profile?.name || "").trim();
    const avatarUrl = String(profile?.picture || "").trim();

    const expectedAud = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    if (safeIdToken && expectedAud && String(profile?.aud || "").trim() !== expectedAud) {
      return res.status(400).json({ code: "error", message: "Token Google không đúng ứng dụng" });
    }
    if (!googleId) {
      return res.status(400).json({ code: "error", message: "Không lấy được thông tin Google" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ code: "error", message: "Tài khoản Google chưa có email" });
    }

    let user = await AccountClient.findOne({ googleId, deleted: false });
    if (!user) {
      user = await AccountClient.findOne({ email, deleted: false });
    }

    if (!user) {
      user = await AccountClient.create({
        fullName: fullName || email,
        email,
        phone: "",
        password: "",
        googleId,
        avatarUrl,
        deleted: false,
      });
    } else {
      const updates = {};
      if (!user.googleId) updates.googleId = googleId;
      if (avatarUrl && !user.avatarUrl) updates.avatarUrl = avatarUrl;
      if (fullName && !user.fullName) updates.fullName = fullName;
      if (Object.keys(updates).length) {
        await AccountClient.updateOne({ _id: user._id }, { $set: updates });
      }
    }

    await mergeGuestToUser({ guestId, userId: user._id });

    const token = jwt.sign(
      { id: user._id, email: user.email, role: "client" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    setClientTokenCookie(req, res, token);

    return res.status(200).json({
      code: "success",
      message: "Đăng nhập Google thành công",
      token,
      data: { id: user._id, fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};

module.exports.oauthFacebook = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { accessToken } = req.body || {};
    const safeAccessToken = String(accessToken || "").trim();
    if (!safeAccessToken) {
      return res.status(400).json({ code: "error", message: "Thiếu token Facebook" });
    }

    // Optional validation via debug_token (recommended)
    const appId = String(process.env.FACEBOOK_APP_ID || "").trim();
    const appSecret = String(process.env.FACEBOOK_APP_SECRET || "").trim();
    if (appId && appSecret) {
      const appAccessToken = `${appId}|${appSecret}`;
      const dbg = await fetchJson(
        `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(
          safeAccessToken
        )}&access_token=${encodeURIComponent(appAccessToken)}`
      );
      const ok = !!dbg?.data?.data?.is_valid;
      const aud = String(dbg?.data?.data?.app_id || "").trim();
      if (!ok || (appId && aud && aud !== appId)) {
        return res.status(400).json({ code: "error", message: "Token Facebook không hợp lệ" });
      }
    }

    const meRes = await fetchJson(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(
        safeAccessToken
      )}`
    );
    if (!meRes.ok) {
      return res.status(400).json({ code: "error", message: "Token Facebook không hợp lệ" });
    }

    const fbId = String(meRes?.data?.id || "").trim();
    const email = String(meRes?.data?.email || "")
      .trim()
      .toLowerCase();
    const fullName = String(meRes?.data?.name || "").trim();
    const avatarUrl = String(meRes?.data?.picture?.data?.url || "").trim();
    if (!fbId) {
      return res.status(400).json({ code: "error", message: "Không lấy được thông tin Facebook" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({
        code: "error",
        message: "Không lấy được email từ Facebook (cần quyền email)",
      });
    }

    let user = await AccountClient.findOne({ facebookId: fbId, deleted: false });
    if (!user) {
      user = await AccountClient.findOne({ email, deleted: false });
    }

    if (!user) {
      user = await AccountClient.create({
        fullName: fullName || email,
        email,
        phone: "",
        password: "",
        facebookId: fbId,
        avatarUrl,
        deleted: false,
      });
    } else {
      const updates = {};
      if (!user.facebookId) updates.facebookId = fbId;
      if (avatarUrl && !user.avatarUrl) updates.avatarUrl = avatarUrl;
      if (fullName && !user.fullName) updates.fullName = fullName;
      if (Object.keys(updates).length) {
        await AccountClient.updateOne({ _id: user._id }, { $set: updates });
      }
    }

    await mergeGuestToUser({ guestId, userId: user._id });

    const token = jwt.sign(
      { id: user._id, email: user.email, role: "client" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    setClientTokenCookie(req, res, token);

    return res.status(200).json({
      code: "success",
      message: "Đăng nhập Facebook thành công",
      token,
      data: { id: user._id, fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    return res.status(500).json({ code: "error", message: "Lỗi server", error: error.message });
  }
};
