import mongoose from "mongoose";

export const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017/rice-erp");
};
