module.exports.sendMail = async (email, subject, content) => {
  const nodemailer = require("nodemailer");
  const envSecure = String(process.env.EMAIL_SECURE || "")
    .trim()
    .toLowerCase();
  const secure = envSecure === "true";
  const user = String(process.env.EMAIL_USERNAME || process.env.EMAIL_NAME || "").trim();
  // Gmail app-passwords are often copied with spaces; strip them.
  const pass = String(process.env.EMAIL_PASSWORD || "").replace(/\s+/g, "");

  if (!user || !pass) {
    console.log("Mailer misconfigured: missing EMAIL_USERNAME/EMAIL_NAME or EMAIL_PASSWORD");
    return null;
  }
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: secure ? 465 : 587,
    secure,
    // Fail fast instead of hanging the request for a long time.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: {
      user,
      pass,
    },
  });

  const mailOptions = {
    from: user,
    to: email,
    subject,
    html: content,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    // Keep behavior backward-compatible: callers historically didn't await.
    console.log("Error:", error);
    return null;
  }
};
