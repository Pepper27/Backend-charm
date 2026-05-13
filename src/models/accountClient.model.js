const mongoose = require("mongoose");

// Minimal client account model used for admin lookups on designs.
// Collection name chosen to match admin naming pattern (account-admin).
const schema = new mongoose.Schema(
  {
    fullName: { type: String, default: "" },
    email: { type: String, default: "", index: true },
    phone: { type: String, default: "" },
    password: { type: String, default: "" },
    // Social login identifiers (optional)
    googleId: { type: String, default: "", index: true },
    facebookId: { type: String, default: "", index: true },
    avatarUrl: { type: String, default: "" },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

schema.index({ fullName: 1 });

const AccountClient = mongoose.model("AccountClient", schema, "account-client");
module.exports = AccountClient;
