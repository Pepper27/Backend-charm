
const { processChatbotMessage } = require("../../services/chatbot/chatbot.service");


module.exports.sendMessage = async (req, res) => {
  try {
    const data = await processChatbotMessage(req.body);
    return res.status(200).json({
      message: "OK",
      data,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || "Chatbot xử lý thất bại",
      code: error?.code || "chatbot_failed",
    });
  }
};
