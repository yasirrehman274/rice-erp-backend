import mongoose from "mongoose";

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/rice-erp";
  const separator = uri.includes("?") ? "&" : "?";
  await mongoose.connect(`${uri}${separator}retryWrites=false`);
};
