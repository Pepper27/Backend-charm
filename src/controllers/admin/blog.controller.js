const Blog = require("../../models/blog.model");
const AccountAdmin = require("../../models/accountAdmin.model");
const mongoose = require("mongoose");
const moment = require("moment");
const slugify = require("slugify");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports.getBlogs = async (req, res) => {
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
      list = await Blog.find(find).sort({ createdAt: -1 }).lean();
      total = list.length;
    } else {
      const safePage = page || 1;
      const safeLimit = limit || 10;
      const skip = (safePage - 1) * safeLimit;

      list = await Blog.find(find).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean();
      total = await Blog.countDocuments(find);
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

module.exports.getBlogById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const current = await Blog.findOne({ _id: id, deleted: false });
    if (!current) {
      return res.status(404).json({ message: "Không tìm thấy bài viết" });
    }

    return res.status(200).json({ data: current });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi", error: error.message });
  }
};

module.exports.createBlog = async (req, res) => {
  try {
    const { name } = req.body;
    const content = req.body.content || "";
    if (!String(name || "").trim()) {
      return res.status(400).json({ success: false, message: "Tên bài viết là bắt buộc!" });
    }

    const existName = await Blog.findOne({ name: String(name).trim(), deleted: false });
    if (existName) {
      return res.status(400).json({ success: false, message: "Tên bài viết đã tồn tại!" });
    }

    const avatar = req.file ? req.file.path : undefined;
    const createdBy = req.account?.id;
    const updatedBy = req.account?.id;

    const newBlog = new Blog({
      name: String(name).trim(),
      content,
      avatar,
      createdBy,
      updatedBy,
    });

    await newBlog.save();
    return res.status(201).json({
      success: true,
      message: "Tạo bài viết thành công!",
      data: newBlog,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports.updateBlogById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const old = await Blog.findOne({ _id: id, deleted: false });
    if (!old) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bài viết!" });
    }

    if (req.body.name) {
      const existName = await Blog.findOne({
        name: String(req.body.name).trim(),
        _id: { $ne: id },
        deleted: false,
      });
      if (existName) {
        return res.status(400).json({ success: false, message: "Tên bài viết đã tồn tại!" });
      }
    }

    const avatar = req.file ? req.file.path : old.avatar;
    const updateData = {
      ...req.body,
      avatar,
      updatedBy: req.account?.id,
      updatedAt: Date.now(),
    };

    if (updateData.desc !== undefined && updateData.content === undefined) {
      updateData.content = updateData.desc;
    }
    delete updateData.desc;

    await Blog.updateOne({ _id: id, deleted: false }, updateData);

    return res.status(200).json({ success: true, message: "Cập nhật bài viết thành công!" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports.deleteBlogById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id không hợp lệ" });
    }

    const old = await Blog.findOne({ _id: id, deleted: false });
    if (!old) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bài viết!" });
    }

    await Blog.updateOne(
      { _id: id, deleted: false },
      { deleted: true, deletedAt: Date.now(), deletedBy: req.account?.id }
    );

    return res.status(200).json({ success: true, message: "Xóa bài viết thành công!" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};
