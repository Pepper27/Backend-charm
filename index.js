const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const { connectDB } = require("./src/config/database.js");
const apiRoutes = require("./src/routes/index.route.js");

const app = express();
const port = process.env.PORT || 3879;
app.set("trust proxy", 1);

// Connect to MongoDB before accepting requests.
// This avoids requests hanging when the DB is unreachable.
const start = async () => {
  await connectDB();

  app.listen(port, () => {
    console.log(`Server chạy tại http://localhost:${port}`);
  });
};
const cookieParser = require("cookie-parser");
app.use(cookieParser("SFGWHSDSGSDSD"));
app.use(express.json());
const isLocalOrigin = (origin) => {
  if (!origin) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

const allowedOrigins = new Set(["http://localhost:3000", "http://localhost:3001"]);

const isAllowedNgrokOrigin = (origin) => {
  if (!origin) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "https:") return false;
    return hostname.endsWith(".ngrok-free.app") || hostname.endsWith(".ngrok-free.dev");
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (isLocalOrigin(origin) || allowedOrigins.has(origin) || isAllowedNgrokOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
    credentials: true,
  })
);
app.use("/api", apiRoutes);

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
