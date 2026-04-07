const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AccountClient = require("../../models/accountClient.model");

// Optional auth: attach req.client if token is present and valid.
module.exports.attachClient = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    const cookieToken = req.cookies?.clientToken;
    const token = headerToken || cookieToken;

    if (!token) {
      req.client = null;
      return next();
    }

    if (mongoose.connection.readyState !== 1) {
      req.client = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const client = await AccountClient.findOne({ _id: decoded.id, deleted: false }).lean().maxTimeMS(5000);
    req.client = client || null;
    return next();
  } catch {
    req.client = null;
    return next();
  }
};

module.exports.requireClient = async (req, res, next) => {
  if (!req.client) {
    return res.status(401).json({ code: "error", message: "Unauthorized" });
  }
  return next();
};
