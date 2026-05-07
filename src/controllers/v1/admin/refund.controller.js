const RefundJob = require("../../../models/refundJob.model");

// GET /api/v1/admin/refunds?status=&limit=&page=
module.exports.list = async (req, res) => {
  try {
    const status = String(req.query.status || "").trim();
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 200);
    const find = {};
    if (status) find.status = status;

    const total = await RefundJob.countDocuments(find);
    const totalPage = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPage);
    const skip = (safePage - 1) * limit;

    const rows = await RefundJob.find(find).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    return res.status(200).json({ data: rows, meta: { total, currentPage: safePage, totalPage, limit }, error: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ data: null, meta: null, error: { message: String(err && err.message) } });
  }
};

// POST /api/v1/admin/refunds/:id/retry
module.exports.retry = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ data: null, error: { message: "Missing id" } });
    const job = await RefundJob.findById(id);
    if (!job) return res.status(404).json({ data: null, error: { message: "Not found" } });
    job.status = "pending";
    job.attempts = 0;
    job.lastError = "";
    job.scheduledAt = new Date();
    await job.save();
    return res.status(200).json({ data: job, meta: null, error: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ data: null, meta: null, error: { message: String(err && err.message) } });
  }
};

// PATCH /api/v1/admin/refunds/:id/manual - mark manual_review or resolved
module.exports.manual = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const action = String(req.body.action || "").trim();
    if (!id || !action) return res.status(400).json({ data: null, error: { message: "Missing id or action" } });
    const job = await RefundJob.findById(id);
    if (!job) return res.status(404).json({ data: null, error: { message: "Not found" } });
    if (action === "mark_manual") {
      job.status = "manual_review";
    } else if (action === "resolve") {
      job.status = "succeeded";
      job.processedAt = new Date();
    } else {
      return res.status(400).json({ data: null, error: { message: "Unknown action" } });
    }
    await job.save();
    return res.status(200).json({ data: job, meta: null, error: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ data: null, meta: null, error: { message: String(err && err.message) } });
  }
};
