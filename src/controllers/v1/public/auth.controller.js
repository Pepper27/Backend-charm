const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const AccountClient = require("../../../models/accountClient.model");
const v1 = require("../../../helper/v1-response.helper");
const RecentlyViewed = require("../../../models/recentlyViewed.model");
const { COOKIE_NAME } = require("../../../helper/guest.helper");

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

    // Merge guest recently-viewed into user after successful login.
    try {
      const guestId = req.cookies?.[COOKIE_NAME];
      if (guestId && typeof guestId === "string" && guestId.trim()) {
        const guestItems = await RecentlyViewed.find({ guestId: String(guestId) })
          .sort({ viewedAt: -1 })
          .limit(50)
          .lean();

        for (const it of guestItems) {
          await RecentlyViewed.findOneAndUpdate(
            { userId: user._id, productId: it.productId },
            {
              $set: {
                viewedAt: it.viewedAt || new Date(),
                variantCode: String(it.variantCode || ""),
              },
              $setOnInsert: { userId: user._id, productId: it.productId },
            },
            { upsert: true, new: false }
          );
        }

        await RecentlyViewed.deleteMany({ guestId: String(guestId) });

        const extra = await RecentlyViewed.find({ userId: user._id })
          .sort({ viewedAt: -1 })
          .skip(50)
          .select("_id")
          .lean();
        if (extra?.length) {
          await RecentlyViewed.deleteMany({ _id: { $in: extra.map((d) => d._id) } });
        }
      }
    } catch {
      // best-effort merge only
    }

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
