const crypto = require("crypto");

const COOKIE_NAME = "guestId";

const ensureGuestIdCookie = (req, res) => {
  const existing = req.cookies?.[COOKIE_NAME];
  if (existing && typeof existing === "string" && existing.trim()) {
    return existing;
  }

  const id = crypto.randomUUID();
  const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
  res.cookie(COOKIE_NAME, id, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  });
  return id;
};

module.exports = {
  COOKIE_NAME,
  ensureGuestIdCookie,
};
