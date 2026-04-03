const bcrypt = require('bcryptjs');
const AccountAdmin = require("../../models/accountAdmin.model")
const jwt = require("jsonwebtoken")
const mailHelper = require("../../helper/mailer.helper")
const randomOtp = require("../../helper/generate.helper")
const ForgotPasswordAdmin= require("../../models/forgotPassword.model")
//login
module.exports.loginPost = async (req,res)=>{
    const {email,password} = req.body
    console.log("LOGIN API HIT");
    const existEmail = await AccountAdmin.findOne({
        email:email
    })
    if(!existEmail){
        res.json({
            code:"error",
            message:"Email không tồn tại trong hệ thống!"
        })
        return
    }
    if(existEmail.status=="initial"){
        res.json({
            code:"error",
            message:"Tài khoản chưa được phê duyệt!"
        })
        return
    }
    const isPassword= await bcrypt.compare(password, existEmail.password)
        
    if(!isPassword){
        res.json({
            code:"error",
            message:"Mật khẩu không đúng!"
        })
        return
    }
    const token = jwt.sign(
        {
            id:existEmail.id,
            email:existEmail.email
        },
        process.env.JWT_SECRET,
        {
            expiresIn:"1d"
        }
    )
    const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
    res.cookie("token", token, {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        // If request is https (ngrok), allow cross-site cookie.
        sameSite: isSecure ? "none" : "lax",
        secure: isSecure,
    })

    res.json({
        code:"success",
        message:"Đăng nhập thành công!",
        token:token
    })
    
}
//end login

//register
module.exports.registerPost = async (req,res)=>{
    const {name,email,password} = req.body;
 
    const existEmail = await AccountAdmin.findOne({
        email:email
    })
    if(existEmail){
        res.json({
            code:"error",
            message:"Email đã tồn tại trong hệ thống!"
        })
        return;
    }
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const dataFinal = new AccountAdmin({name,email,password:hash,status:"initial"})

    await dataFinal.save()
    res.json({
        code:"success",
        message:"Đăng ký tài khoản thành công!"
    })
}    
//end register

//forgot-password
module.exports.forgotPasswordPost = async(req,res)=>{
    // console.log(req.body)

    const {email} = req.body
    const existEmail =  await AccountAdmin.findOne({
        email:email
    })
    if(!existEmail){
        res.json({
            code:"error",
            message:"Email không tồn tại trong hệ thống!"
        })
        return
    }
    const existOtp = await ForgotPasswordAdmin.findOne({
        email:email
    })
    if(existOtp){
        res.json({
            code:"error",
            message:"Mã otp đã được gửi, vui lòng đợi 3 phút sau để gửi lại!"
        })
        return
    }
    const otp = randomOtp.RandomNumber(6)
    const creatOtp = new ForgotPasswordAdmin({
        email,
        otp,
        expireAt:Date.now()+3*60*1000
    })
    await creatOtp.save()
    const subject ="Mã otp đổi mật khẩu"
    const content = `<span>Mã otp của bạn: </span><b style="color:green">${otp} </b><span>Vui lòng không chia sẻ cho bất kỳ ai!</span>`
    mailHelper.mailHelper(email,subject,content)
    res.json({
        code:"success",
        message:"Gửi mã otp thành công!"
    })

}
//End forgot-password

//otp-password
module.exports.otpPasswordPost = async (req,res)=>{
    const {otp} = req.body
    const existOtp = await ForgotPasswordAdmin.findOne({
        otp:otp
    })
    if(!existOtp){
        res.json({
            code:"error",
            message:"Mã otp của bạn không đúng hoặc hết hạn!"
        })
        return
    }
    const token = jwt.sign(
        {
            id:existOtp.id,
            email:existOtp.email
        },
        process.env.JWT_SECRET,
        {
            expiresIn:"1d"
        }
    )
    // console.log(token)
    const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
    res.cookie("token", token, {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: isSecure ? "none" : "lax",
        secure: isSecure,
    })

    res.json({
        code:"success",
        message:"Xác thực mã otp thành công!"
    })
}
//End otp-password

//reset-password
module.exports.resetPasswordPost = async (req,res)=>{
    // console.log(req.account.email)
    const email = req.account.email
    const {confirmPass} = req.body

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(confirmPass, salt);

    await AccountAdmin.updateOne({
        email
    },{
        password:hash
    })
    res.clearCookie("token");
    res.json({
        code:"success",
        message:"Đổi mật khẩu thành công!"
    })
} 
//End reset-password

//logout
module.exports.logoutPost = async (req,res)=>{
    const isSecure = !!(req.secure || req.headers["x-forwarded-proto"] === "https");
    res.clearCookie("token", {
        httpOnly: true,
        sameSite: isSecure ? "none" : "lax",
        secure: isSecure,
    });
    res.json({
        code:"success",
        message:"Đăng xuất thành công!"
    })
} 
//end-logout
module.exports.getName = async (req,res)=>{
    try {
        if (!req.account) {
            return res.status(401).json({
                message: "Unauthorized"
            });
        }

        const user = await AccountAdmin.findOne({
            _id: req.account.id,
        });

        if (!user) {
            return res.status(401).json({
                message: "User not found"
            });
        }

        return res.status(200).json({
            data: user
        });

    } catch (err) {
        return res.status(500).json({ message: "Lỗi server" });
    }
}
