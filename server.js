import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import supplierRoutes from "./routes/supplierRoutes.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

const app = express();
const port = 4000;

app.use(express.json());
app.use(cors());

connectDB().catch((error) => {
  console.error("MongoDB connection failed:", error.message);
});

app.get("/", (req, res) => {
  res.send("API Working");
});

app.use("/api/warehouses", warehouseRoutes);
app.use("/api/suppliers", supplierRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`server start on port ${port}`);
});
