const mongoose = require("mongoose");
const AccountClient = require("../../models/accountClient.model");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports.getClients = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const parsedLimit = Number.parseInt(req.query.limit, 10) || 10;
    const limit = Math.min(Math.max(parsedLimit, 1), 50);
    const keyword = String(req.query.keyword || "").trim();

    const find = { deleted: false };
    if (keyword) {
      const rx = new RegExp(escapeRegex(keyword), "i");
      find.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
    }

    const total = await AccountClient.countDocuments(find);
    const totalPage = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPage);
    const skip = (safePage - 1) * limit;

    const clients = await AccountClient.find(find)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("fullName email phone createdAt")
      .lean();

    return res.status(200).json({
      data: clients || [],
      total,
      currentPage: safePage,
      totalPage,
      limit,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Lỗi khi lấy danh sách khách hàng", error: error.message });
  }
};

module.exports.getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const client = await AccountClient.findOne({ _id: id, deleted: false })
      .select("fullName email phone createdAt")
      .lean();
    if (!client) {
      return res.status(404).json({ message: "Không tìm thấy tài khoản khách hàng" });
    }

    return res.status(200).json({ data: client });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};

module.exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const old = await AccountClient.findOne({ _id: id, deleted: false }).lean();
    if (!old) {
      return res.status(404).json({ message: "Không tìm thấy tài khoản khách hàng" });
    }

    await AccountClient.updateOne(
      { _id: id, deleted: false },
      {
        $set: {
          deleted: true,
          deletedAt: new Date(),
          deletedBy: req.account?.id ? String(req.account.id) : "",
        },
      }
    );

    return res.status(200).json({ message: "Xóa tài khoản khách hàng thành công" });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};
