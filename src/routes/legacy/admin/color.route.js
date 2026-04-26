const router = require("express").Router();
const authMiddleware = require("../../../middlewares/admin/auth.middleware");
const Color = require("../../../models/color.model");

router.get("/", authMiddleware.verifyToken, async (req, res) => {
	try {
		const list = await Color.find({ deleted: false }).lean();
		res.status(200).json({ data: list });
	} catch (err) {
		res.status(500).json({ message: "Lỗi server" });
	}
});

router.get("/:id", authMiddleware.verifyToken, async (req, res) => {
	try {
		const item = await Color.findOne({ _id: req.params.id, deleted: false });
		if (!item) return res.status(404).json({ message: "Không tìm thấy" });
		res.status(200).json({ data: item });
	} catch (err) {
		res.status(500).json({ message: "Lỗi server" });
	}
});

router.post("/", authMiddleware.verifyToken, async (req, res) => {
	try {
		const m = new Color(req.body);
		await m.save();
		res.status(200).json({ code: "success" });
	} catch (err) {
		res.status(500).json({ code: "error", message: err.message });
	}
});

router.patch("/:id", authMiddleware.verifyToken, async (req, res) => {
	try {
		await Color.updateOne({ _id: req.params.id }, req.body);
		res.status(200).json({ code: "success" });
	} catch (err) {
		res.status(500).json({ code: "error", message: err.message });
	}
});

router.delete("/:id", authMiddleware.verifyToken, async (req, res) => {
	try {
		await Color.updateOne({ _id: req.params.id }, { deleted: true, deletedAt: Date.now(), deletedBy: req.account.id });
		res.status(200).json({ code: "success" });
	} catch (err) {
		res.status(500).json({ code: "error", message: err.message });
	}
});

module.exports = router;
