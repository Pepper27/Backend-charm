const crypto = require("crypto");

const COOKIE_NAME = "guestId";

const buildGuestCookieOptions = (req) => {
  const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
  return {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  };
};

const setGuestIdCookie = (req, res, guestId) => {
  const nextId = String(guestId || "").trim() || crypto.randomUUID();
  res.cookie(COOKIE_NAME, nextId, buildGuestCookieOptions(req));
  return nextId;
};

const clearGuestIdCookie = (req, res) => {
  const { maxAge, ...options } = buildGuestCookieOptions(req);
  res.clearCookie(COOKIE_NAME, options);
};

const rotateGuestIdCookie = (req, res) => setGuestIdCookie(req, res, crypto.randomUUID());

const ensureGuestIdCookie = (req, res) => {
  const existing = req.cookies?.[COOKIE_NAME];
  if (existing && typeof existing === "string" && existing.trim()) {
    return existing;
  }

  return setGuestIdCookie(req, res);
};

module.exports = {
  COOKIE_NAME,
  setGuestIdCookie,
  clearGuestIdCookie,
  rotateGuestIdCookie,
  ensureGuestIdCookie,
};
