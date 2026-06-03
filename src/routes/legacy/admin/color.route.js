const router = require("express").Router();
const authMiddleware = require("../../../middlewares/admin/auth.middleware");
const Color = require("../../../models/color.model");
const AccountAdmin = require("../../../models/accountAdmin.model");
const moment = require("moment");
router.get("/", authMiddleware.verifyToken, async (req, res) => {
<<<<<<< HEAD
	try {
		const list = await Color.find({ deleted: false }).lean();
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
=======
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit)) : null;
        const keyword = (req.query.keyword || "").trim();
        const filter = { deleted: false };
        if (keyword) {
            const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(esc, 'i');
            filter.$or = [
                { name: re },
                { codeColor: re },
                { codeHex: re },
                { slug: re },
            ];
        }

        const total = await Color.countDocuments(filter);
        let list;
        if (limit) {
            list = await Color.find(filter).skip((page - 1) * limit).limit(limit).lean();
        } else {
            list = await Color.find(filter).lean();
        }

        for (const item of list) {
            if (item.createdBy) {
                const createdByName = await AccountAdmin.findOne({ _id: item.createdBy });
                item.createdByName = createdByName?.fullName;
            }
            if (item.updatedBy) {
                const updatedByName = await AccountAdmin.findOne({ _id: item.updatedBy });
                item.updatedByName = updatedByName?.fullName;
            }
            item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
            item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");
        }

        const totalPage = limit ? Math.max(1, Math.ceil(total / limit)) : 1;
        res.status(200).json({ data: list, total, totalPage, page });
    } catch (err) {
        res.status(500).json({ message: "Lỗi server" });
    }
>>>>>>> 2e649376b0c0761ae8c75e225aa776d86739179d
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
		req.body.createdBy = req.account.id;
		req.body.updatedBy = req.account.id;
		const m = new Color(req.body);
		await m.save();
		res.status(200).json({ code: "success" });
	} catch (err) {
		res.status(500).json({ code: "error", message: err.message });
	}
});

router.patch("/:id", authMiddleware.verifyToken, async (req, res) => {
	try {
		req.body.updatedBy = req.account.id;
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
