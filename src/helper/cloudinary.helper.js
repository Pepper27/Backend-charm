const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "category",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

// Collection media storage (supports image + video)
const collectionStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "collection",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "mp4", "webm", "mov"],
  },
});

module.exports = {
  cloudinary,
  storage,
  collectionStorage,
};
