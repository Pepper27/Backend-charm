const mongoose = require('mongoose');
const { Schema } = mongoose;

const chatInquirySchema = new Schema(
  {
    name: String,
    email: String,
    phone: String,
    message: String,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true }
);

const ChatInquiry = mongoose.model('ChatInquiry', chatInquirySchema);
module.exports = ChatInquiry;
