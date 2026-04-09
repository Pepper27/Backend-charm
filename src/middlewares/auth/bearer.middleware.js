const jwt = require("jsonwebtoken");
const v1 = require("../../helper/v1-response.helper");

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [scheme, token] = String(authHeader).split(" ");
  if (scheme !== "Bearer") return null;
  return (token || "").trim() || null;
};

// Verifies JWT from Authorization header.
// Attaches req.auth = { id, email, role }.
module.exports.requireAuth = (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return v1.fail(res, 401, "UNAUTHORIZED", "Missing Bearer token");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = {
      id: decoded?.id ? String(decoded.id) : null,
      email: decoded?.email ? String(decoded.email) : null,
      role: decoded?.role ? String(decoded.role) : null,
    };
    return next();
  } catch (error) {
    const code = error?.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN";
    return v1.fail(res, 401, code, "Invalid token");
  }
};

module.exports.requireRole = (role) => (req, res, next) => {
  if (!req.auth?.role || req.auth.role !== role) {
    return v1.fail(res, 403, "FORBIDDEN", "Forbidden");
  }
  return next();
};
