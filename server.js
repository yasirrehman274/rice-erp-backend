import "dotenv/config";
import app from "./app.js";
import { connectDB } from "./config/db.js";

const port = process.env.PORT || 4000;

connectDB().catch((error) => {
  console.error("MongoDB connection failed:", error.message);
});

app.listen(port, () => {
  console.log(`server start on port ${port}`);
});
