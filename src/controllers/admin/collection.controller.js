const Collection = require("../../models/collection.model");
const AccountAdmin = require("../../models/accountAdmin.model");
const mongoose = require("mongoose");
const moment = require("moment");
const slugify = require("slugify");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports.getCollections = async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page, 10) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const keyword = String(req.query.keyword || "").trim();

    const find = { deleted: false };
    if (keyword) {
      const slugKeyword = slugify(keyword, { lower: true, strict: true });
      find.$or = [
        { slug: { $regex: slugKeyword, $options: "i" } },
        { name: { $regex: new RegExp(escapeRegex(keyword), "i") } },
      ];
    }

    let list;
    let total;

    if (!page && !limit) {
      list = await Collection.find(find).sort({ createdAt: -1 }).lean();
      total = list.length;
    } else {
      const safePage = page || 1;
      const safeLimit = limit || 10;
      const skip = (safePage - 1) * safeLimit;

      list = await Collection.find(find).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean();
      total = await Collection.countDocuments(find);
    }

    for (const item of list) {
      if (item.createdBy && mongoose.Types.ObjectId.isValid(item.createdBy)) {
        const createdBy = await AccountAdmin.findOne({
          _id: item.createdBy,
          deleted: false,
        }).select("fullName");
        item.createdByName = createdBy?.fullName;
      }
      if (item.updatedBy && mongoose.Types.ObjectId.isValid(item.updatedBy)) {
        const updatedBy = await AccountAdmin.findOne({
          _id: item.updatedBy,
          deleted: false,
        }).select("fullName");
        item.updatedByName = updatedBy?.fullName;
      }
      item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
      item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");
    }

    return res.status(200).json({
      data: list,
      total,
      currentPage: page || 1,
      totalPage: limit ? Math.ceil(total / limit) : 1,
    });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi", error: error.message });
  }
};

module.exports.getCollectionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const current = await Collection.findOne({ _id: id, deleted: false });
    if (!current) {
      return res.status(404).json({ message: "Không tìm thấy bộ sưu tập" });
    }

    return res.status(200).json({ data: current });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi", error: error.message });
  }
};

module.exports.createCollection = async (req, res) => {
  try {
    const { name } = req.body;
    const description = req.body.description || req.body.desc || "";
    if (!String(name || "").trim()) {
      return res.status(400).json({ success: false, message: "Tên bộ sưu tập là bắt buộc!" });
    }

    const existName = await Collection.findOne({ name: String(name).trim(), deleted: false });
    if (existName) {
      return res.status(400).json({ success: false, message: "Tên bộ sưu tập đã tồn tại!" });
    }

    const avatar = req.files?.avatar?.[0]?.path;
    const video = req.files?.video?.[0]?.path;
    const poster = req.files?.poster?.[0]?.path;
    const createdBy = req.account?.id;
    const updatedBy = req.account?.id;

    const newCollection = new Collection({
      name: String(name).trim(),
      description,
      avatar,
      video,
      poster,
      createdBy,
      updatedBy,
    });

    await newCollection.save();
    return res.status(201).json({
      success: true,
      message: "Tạo bộ sưu tập thành công!",
      data: newCollection,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports.updateCollectionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const old = await Collection.findOne({ _id: id, deleted: false });
    if (!old) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bộ sưu tập!" });
    }

    if (req.body.name) {
      const existName = await Collection.findOne({
        name: String(req.body.name).trim(),
        _id: { $ne: id },
        deleted: false,
      });
      if (existName) {
        return res.status(400).json({ success: false, message: "Tên bộ sưu tập đã tồn tại!" });
      }
    }

    const avatar = req.files?.avatar?.[0]?.path || old.avatar;
    const video = req.files?.video?.[0]?.path || old.video;
    const poster = req.files?.poster?.[0]?.path || old.poster;
    const updateData = {
      ...req.body,
      avatar,
      video,
      poster,
      updatedBy: req.account?.id,
      updatedAt: Date.now(),
    };

    // Normalize supported fields
    if (updateData.desc !== undefined && updateData.description === undefined) {
      updateData.description = updateData.desc;
    }
    delete updateData.desc;

    await Collection.updateOne({ _id: id, deleted: false }, updateData);

    return res.status(200).json({ success: true, message: "Cập nhật bộ sưu tập thành công!" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports.deleteCollectionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const old = await Collection.findOne({ _id: id, deleted: false });
    if (!old) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bộ sưu tập!" });
    }

    await Collection.updateOne(
      { _id: id, deleted: false },
      { deleted: true, deletedAt: Date.now(), deletedBy: req.account?.id }
    );

    return res.status(200).json({ success: true, message: "Xóa bộ sưu tập thành công!" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};
