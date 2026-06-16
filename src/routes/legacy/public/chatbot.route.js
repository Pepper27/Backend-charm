const router = require("express").Router();
const chatbotController = require("../../../controllers/public/chatbot.controller");

router.post("/message", chatbotController.sendMessage);

module.exports = router;
