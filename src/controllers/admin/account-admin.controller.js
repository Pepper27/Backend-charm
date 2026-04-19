const bcrypt = require("bcryptjs");
const AccountAdmin = require("../../models/accountAdmin.model");
const Role = require("../../models/role.model");
const jwt = require("jsonwebtoken");
const mailHelper = require("../../helper/mailer.helper");
const randomOtp = require("../../helper/generate.helper");
const ForgotPasswordAdmin = require("../../models/forgotPassword.model");
//login
module.exports.loginPost = async (req, res) => {
  const { email, password } = req.body;
  console.log("LOGIN API HIT");
  const existEmail = await AccountAdmin.findOne({
    email: email,
  });
  if (!existEmail) {
    res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thống!",
    });
    return;
  }
  if (existEmail.status == "initial") {
    res.json({
      code: "error",
      message: "Tài khoản chưa được phê duyệt!",
    });
    return;
  }
  const isPassword = await bcrypt.compare(password, existEmail.password);

  if (!isPassword) {
    res.json({
      code: "error",
      message: "Mật khẩu không đúng!",
    });
    return;
  }
  const token = jwt.sign(
    {
      id: existEmail.id,
      email: existEmail.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );
  const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
  res.cookie("token", token, {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    // If request is https (ngrok), allow cross-site cookie.
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  });

  res.json({
    code: "success",
    message: "Đăng nhập thành công!",
    token: token,
  });
};
//end login

//register
// module.exports.registerPost = async (req,res)=>{
//     const {name,email,password} = req.body;

//     const existEmail = await AccountAdmin.findOne({
//         email:email
//     })
//     if(existEmail){
//         res.json({
//             code:"error",
//             message:"Email đã tồn tại trong hệ thống!"
//         })
//         return;
//     }
//     const salt = bcrypt.genSaltSync(10);
//     const hash = bcrypt.hashSync(password, salt);

//     const dataFinal = new AccountAdmin({name,email,password:hash,status:"initial"})

//     await dataFinal.save()
//     res.json({
//         code:"success",
//         message:"Đăng ký tài khoản thành công!"
//     })
// }
//end register

//forgot-password
module.exports.forgotPasswordPost = async (req, res) => {
  // console.log(req.body)

  const { email } = req.body;
  const existEmail = await AccountAdmin.findOne({
    email: email,
  });
  if (!existEmail) {
    res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thống!",
    });
    return;
  }
  const existOtp = await ForgotPasswordAdmin.findOne({
    email: email,
  });
  if (existOtp) {
    res.json({
      code: "error",
      message: "Mã otp đã được gửi, vui lòng đợi 3 phút sau để gửi lại!",
    });
    return;
  }
  const otp = randomOtp.RandomNumber(6);
  const creatOtp = new ForgotPasswordAdmin({
    email,
    otp,
    expireAt: Date.now() + 3 * 60 * 1000,
  });
  await creatOtp.save();
  const subject = "Mã otp đổi mật khẩu";
  const content = `<span>Mã otp của bạn: </span><b style="color:green">${otp} </b><span>Vui lòng không chia sẻ cho bất kỳ ai!</span>`;
  mailHelper.mailHelper(email, subject, content);
  res.json({
    code: "success",
    message: "Gửi mã otp thành công!",
  });
};
//End forgot-password

//otp-password
module.exports.otpPasswordPost = async (req, res) => {
  const { otp } = req.body;
  const existOtp = await ForgotPasswordAdmin.findOne({
    otp: otp,
  });
  if (!existOtp) {
    res.json({
      code: "error",
      message: "Mã otp của bạn không đúng hoặc hết hạn!",
    });
    return;
  }
  const token = jwt.sign(
    {
      id: existOtp.id,
      email: existOtp.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );
  // console.log(token)
  const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
  res.cookie("token", token, {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  });

  res.json({
    code: "success",
    message: "Xác thực mã otp thành công!",
  });
};
//End otp-password

//reset-password
module.exports.resetPasswordPost = async (req, res) => {
  // console.log(req.account.email)
  const email = req.account.email;
  const { confirmPass } = req.body;

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(confirmPass, salt);

  await AccountAdmin.updateOne(
    {
      email,
    },
    {
      password: hash,
    }
  );
  res.clearCookie("token");
  res.json({
    code: "success",
    message: "Đổi mật khẩu thành công!",
  });
};
//End reset-password

//logout
module.exports.logoutPost = async (req, res) => {
  const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  });
  res.json({
    code: "success",
    message: "Đăng xuất thành công!",
  });
};
//end-logout
module.exports.getName = async (req, res) => {
  try {
    if (!req.account) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await AccountAdmin.findOne({
      _id: req.account.id,
    }).lean();

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    let permissions = [];
    if (user.role) {
      const role = await Role.findOne({
        _id: user.role,
        deleted: false,
      }).lean();
      permissions = Array.isArray(role?.permissions) ? role.permissions : [];
    }

    return res.status(200).json({
      data: {
        ...user,
        permissions,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi server" });
  }
};

module.exports.getAccountAdmins = async (req, res) => {
  try {
    if (!req.account) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await AccountAdmin.find({
      deleted: false,
    });

    if (!user) {
      return res.status(401).json({
        message: "Users not found",
      });
    }

    return res.status(200).json({
      data: user,
    });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi server" });
  }
};
module.exports.getAccountAdminsById = async (req, res) => {
  try {
    const id = req.params.id;
    if (!req.account) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await AccountAdmin.findOne({
      _id: id,
      deleted: false,
    });

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      data: user,
    });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi server" });
  }
};

module.exports.accountAdminCreate = async (req, res) => {
  const existAccount = await AccountAdmin.findOne({
    email: req.body.email,
  });
  if (req.file) {
    req.body.avatar = req.file.path;
  } else {
    delete req.body.avater;
  }
  if (existAccount) {
    res.json({
      code: "error",
      message: "Email đã tồn tại trong hệ thống!",
    });
    return;
  }
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(req.body.password, salt);
  req.body.password = hash;

  const dataFinal = new AccountAdmin(req.body);
  await dataFinal.save();
  return res.status(200).json({
    code: "success",
  });
};

module.exports.accountAdminUpdate = async (req, res) => {
  try {
    const id = req.params.id;
    if (req.file) {
      req.body.avatar = req.file.path;
    } else {
      delete req.body.avatar;
    }

    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(req.body.password, salt);
      req.body.password = hash;
    }
    await AccountAdmin.updateOne(
      {
        _id: id,
      },
      req.body
    );
    res.status(200).json({
      code: "success",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Cập nhật tài khoản thất bại!",
    });
  }
};

module.exports.accountAdminDelete = async (req, res) => {
  try {
    const id = req.params.id;
    await AccountAdmin.deleteOne({
      _id: id,
    });
    return res.status(200).json({
      code: "success",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Xóa tài khoản thất bại!",
    });
  }
};
