import mongoose from "mongoose";

let dbPromise = null;

export const connectDB = async () => {
  if (dbPromise) return dbPromise;

  const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017/rice-erp";
  const separator = uri.includes("?") ? "&" : "?";
  dbPromise = mongoose.connect(`${uri}${separator}retryWrites=false`);

  try {
    await dbPromise;
  } catch (err) {
    dbPromise = null;
    throw err;
  }
};
