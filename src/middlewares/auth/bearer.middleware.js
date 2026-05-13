const jwt = require("jsonwebtoken");
const AccountAdmin = require("../../models/accountAdmin.model");
const AccountClient = require("../../models/accountClient.model");

/**
 * Authentication middleware for v1 routes
 */
const requireAuth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "authentication_required",
        message: "Authentication required",
      });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "default-secret");

    // If token contains role, verify against corresponding model
    const roleFromToken = decoded.role || decoded.roles || null;
    if (roleFromToken === "admin") {
      const admin = await AccountAdmin.findOne({ _id: decoded.id, deleted: false });
      if (!admin) {
        return res
          .status(401)
          .json({ success: false, error: "user_not_found", message: "Admin not found" });
      }
      if (admin.status === "initial") {
        return res
          .status(401)
          .json({ success: false, error: "user_inactive", message: "Admin not approved" });
      }
      req.auth = { id: admin._id, email: admin.email, role: "admin" };
    } else if (roleFromToken === "client") {
      const client = await AccountClient.findOne({ _id: decoded.id, deleted: false });
      if (!client) {
        return res
          .status(401)
          .json({ success: false, error: "user_not_found", message: "Client not found" });
      }
      req.auth = { id: client._id, email: client.email, role: "client" };
    } else {
      // Fallback: accept token if valid and attach basic info
      req.auth = {
        id: decoded.id || decoded.userId,
        email: decoded.email,
        role: roleFromToken || "user",
      };
    }

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: "invalid_token",
        message: "Invalid token",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "token_expired",
        message: "Token expired",
      });
    }

    console.error("Authentication error:", error);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error",
    });
  }
};

/**
 * Optional authentication middleware.
 * If no bearer token (or token invalid/expired), request continues as guest.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "default-secret");

    const roleFromToken = decoded.role || decoded.roles || null;
    if (roleFromToken === "admin") {
      const admin = await AccountAdmin.findOne({ _id: decoded.id, deleted: false });
      if (admin && admin.status !== "initial") {
        req.auth = { id: admin._id, email: admin.email, role: "admin" };
      }
    } else if (roleFromToken === "client") {
      const client = await AccountClient.findOne({ _id: decoded.id, deleted: false });
      if (client) {
        req.auth = { id: client._id, email: client.email, role: "client" };
      }
    } else {
      req.auth = {
        id: decoded.id || decoded.userId,
        email: decoded.email,
        role: roleFromToken || "user",
      };
    }

    return next();
  } catch {
    // Treat invalid/expired token as guest
    return next();
  }
};

/**
 * Role-based authorization middleware for v1 routes
 */
const requireRole = (role) => {
  return (req, res, next) => {
    try {
      if (!req.auth) {
        return res.status(401).json({
          success: false,
          error: "authentication_required",
          message: "Authentication required",
        });
      }

      if (req.auth.role !== role) {
        return res.status(403).json({
          success: false,
          error: "insufficient_permissions",
          message: "Insufficient permissions",
        });
      }

      next();
    } catch (error) {
      console.error("Authorization error:", error);
      return res.status(500).json({
        success: false,
        error: "internal_error",
        message: "Internal server error",
      });
    }
  };
};

module.exports = {
  requireAuth,
  requireRole,
  optionalAuth,
};
