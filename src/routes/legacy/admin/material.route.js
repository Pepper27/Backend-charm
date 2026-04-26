const router = require("express").Router();
const authMiddleware = require("../../../middlewares/admin/auth.middleware");
const Material = require("../../../models/material.model");
const AccountAdmin = require("../../../models/accountAdmin.model");
const moment = require("moment");
// List
router.get("/", authMiddleware.verifyToken, async (req, res) => {
	try {
		const list = await Material.find({ deleted: false }).lean();
		for (const item of list) {
			if (item.createdBy) {
				const createdByName = await AccountAdmin.findOne({
				_id: item.createdBy,
				});
				item.createdByName = createdByName?.fullName;
			}
			if (item.updatedBy) {
				const updatedByName = await AccountAdmin.findOne({
				_id: item.updatedBy,
				});
				item.updatedByName = updatedByName?.fullName;
			}
			item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
			item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");
		}
		res.status(200).json({ data: list });
	} catch (err) {
		res.status(500).json({ message: "Lỗi server" });
	}
});

// Get by id
router.get("/:id", authMiddleware.verifyToken, async (req, res) => {
	try {
		const item = await Material.findOne({ _id: req.params.id, deleted: false });
		if (!item) return res.status(404).json({ message: "Không tìm thấy" });
		res.status(200).json({ data: item });
	} catch (err) {
		res.status(500).json({ message: "Lỗi server" });
	}
});

// Create
router.post("/", authMiddleware.verifyToken, async (req, res) => {
	try {
		req.body.createdBy = req.account.id;
		req.body.updatedBy = req.account.id;
		const m = new Material(req.body);
		await m.save();
		res.status(200).json({ code: "success" });
	} catch (err) {
		res.status(500).json({ code: "error", message: err.message });
	}
});

// Update
router.patch("/:id", authMiddleware.verifyToken, async (req, res) => {
	try {
		req.body.updatedBy = req.account.id;
		await Material.updateOne({ _id: req.params.id }, req.body);
		res.status(200).json({ code: "success" });
	} catch (err) {
		res.status(500).json({ code: "error", message: err.message });
	}
});

// Delete (soft)
router.delete("/:id", authMiddleware.verifyToken, async (req, res) => {
	try {
		await Material.updateOne({ _id: req.params.id }, { deleted: true, deletedAt: Date.now(), deletedBy: req.account.id });
		res.status(200).json({ code: "success" });
	} catch (err) {
		res.status(500).json({ code: "error", message: err.message });
	}
});

module.exports = router;
