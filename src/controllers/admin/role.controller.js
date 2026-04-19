const Role = require("../../models/role.model");
const AccountAdmin = require("../../models/accountAdmin.model");
const moment = require("moment")
const slugify= require("slugify")
module.exports.getRoles = async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const limit =4;
    const keyword = req.query.keyword || "";
    const find = { deleted: false };
    const startDate = req.query.start
    const endDate = req.query.end
    const filterDate = {}
    if(startDate){
        filterDate.$gte = moment(startDate).startOf("date").toDate()
    }
    if(endDate){
        filterDate.$lte = moment(endDate).endOf("date").toDate()
    }
    if(Object.keys(filterDate).length>0){
        find.createdAt = filterDate
    }
    if (keyword) {
      const slugKeyword = slugify(keyword, {
        lower: true,
        strict: true,
      });
      find.slug = { $regex: slugKeyword, $options: "i" };
    }
    const skip = (page - 1) * limit;
    const roleList = await Role.find(find)
    .skip(skip)
    .limit(limit)
    .lean();
    const roleTotal = await Role.countDocuments(find);
    for (const item of roleList) {
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
    return res.status(200).json({
      data: roleList,
      total: roleTotal,
      currentPage: page,
      totalPage: Math.ceil(roleTotal / limit),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi",
      error: error.message,
    });
  }
};
module.exports.getRolesById = async (req, res) => {
  try {
    const id = req.params.id;
    const role = await Role.findOne({
      _id: id,
      deleted: false,
    });
    if (!role) {
      res.status(404).json({
        message: "Không tìm thấy quyền này!",
      });
    }
    res.status(200).json({
      data: role,
    });
  } catch (error) {
    res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }
};

module.exports.getRolesAll = async (req, res) => {
  try {
    const roleList = await Role.find({
      deleted: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      data: roleList,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }
};
module.exports.roleCreate = async (req, res) => {
  req.body.createdBy = req.account.id;
  req.body.updatedBy = req.account.id;
  const dataFinal = new Role(req.body);
  await dataFinal.save();
  res.json({
    code: "success",
  });
};

module.exports.roleUpdate = async (req, res) => {
  try {
    const id = req.params.id;
    req.body.updatedBy = req.account.id;
    await Role.updateOne(
      {
        _id: id,
        deleted: false,
      },
      req.body
    );
    res.json({
      code: "success",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Cập nhật thất bại!",
    });
  }
};

module.exports.roleDelete = async (req, res) => {
  try {
    const id = req.params.id;
    await Role.updateOne(
      {
        _id: id,
      },
      {
        deleted: true,
        deletedAt: Date.now(),
        deletedBy: req.account.id,
      }
    );
    res.json({
      code: "success",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Xóa thất bại!",
    });
  }
};
