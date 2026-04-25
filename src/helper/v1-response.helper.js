const toMessage = (error) => {
  if (!error) return "Server error";
  if (typeof error === "string") return error;
  return error.message || "Server error";
};

module.exports.ok = (res, data, options = {}) => {
  const { meta = null, filters = null } = options;
  return res.status(200).json({ data, meta, filters, error: null });
};

module.exports.created = (res, data, options = {}) => {
  const { meta = null, filters = null } = options;
  return res.status(201).json({ data, meta, filters, error: null });
};

module.exports.fail = (res, status, code, message, meta = null) => {
  return res.status(status).json({
    data: null,
    meta,
    error: { code: String(code || "ERROR"), message: String(message || "Error") },
  });
};

module.exports.serverError = (res, error) => {
  return res.status(500).json({
    data: null,
    meta: null,
    error: { code: "SERVER_ERROR", message: toMessage(error) },
  });
};
