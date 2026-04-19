const SettingWebsiteInfo = require("../../models/settingWebsiteInfo.model");

module.exports.getWebsiteInfo = async (req, res) => {
  try {
    const data = await SettingWebsiteInfo.findOne({}).lean();
    return res.status(200).json({
      data: data || {},
    });
  } catch (error) {
    return res.status(500).json({
      code: "error",
      message: "Lấy thông tin website thất bại!",
    });
  }
};

module.exports.updateWebsiteInfo = async (req, res) => {
  try {
    if (req.files && req.files.logo) {
      req.body.logo = req.files.logo[0].path;
    } else {
      delete req.body.logo;
    }

    if (req.files && req.files.favicon) {
      req.body.favicon = req.files.favicon[0].path;
    } else {
      delete req.body.favicon;
    }

    const websiteInfo = await SettingWebsiteInfo.findOne({});
    if (websiteInfo) {
      await SettingWebsiteInfo.updateOne({ _id: websiteInfo._id }, req.body);
    } else {
      const dataFinal = new SettingWebsiteInfo(req.body);
      await dataFinal.save();
    }

    return res.status(200).json({
      code: "success",
      message: "Cập nhật thông tin website thành công!",
    });
  } catch (error) {
    return res.status(500).json({
      code: "error",
      message: "Cập nhật thông tin website thất bại!",
    });
  }
};
