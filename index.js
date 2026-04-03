const express = require('express')
const cors = require("cors")
const dotenv= require("dotenv")
dotenv.config()
const { connectDB } = require("./config/database.js")
const indexRouteAdmin  = require('./routes/admin/index.route.js')
const app = express()
const port = process.env.PORT || 3888;
app.set("trust proxy", 1);
connectDB();
const cookieParser = require("cookie-parser");
app.use(cookieParser("SFGWHSDSGSDSD"));
app.use(express.json());

// Dev-friendly CORS:
// - allow localhost on any port (CRA may use 3000/3001/3002...)
// - allow ngrok free domains (they change frequently)
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

const allowedOrigins = new Set([
  // Keep explicit list for reference; local origins are handled by isLocalOrigin.
  "http://localhost:3000",
  "http://localhost:3001",
]);

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
 
app.use(cors({
  origin: function(origin, callback){
    // allow non-browser tools (curl/postman) with no Origin header
    if (!origin) {
      callback(null, true);
      return;
    }
    if (isLocalOrigin(origin) || allowedOrigins.has(origin) || isAllowedNgrokOrigin(origin)){
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  credentials: true,
}));
app.use("/api/admin",indexRouteAdmin)
app.listen(port, () => {
  console.log(`Server chạy tại http://localhost:${port}`);
});
