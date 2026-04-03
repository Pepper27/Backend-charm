module.exports.sendMail =(email,subject,content) => {
    const nodemailer = require('nodemailer');
    const secure = process.env.EMAIL_SECURE =="false" ? false:true
    const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: secure,
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
    }
    });

    const mailOptions = {
    from:  process.env.EMAIL_USERNAME,
    to: email,
    subject: subject,
    html: content
    };

    transporter.sendMail(mailOptions, function(error, info){
    if (error) {
        console.log('Error:', error);
    } else {
        console.log('Email sent: ', info.response);
    }
    });
}