import mongoose from "mongoose";

let dbPromise = null;

export const connectDB = async () => {
  if (dbPromise) return dbPromise;

  const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017/rice-erp";
  const finalUri = uri.includes("retryWrites")
    ? uri
    : `${uri}${uri.includes("?") ? "&" : "?"}retryWrites=false`;
  dbPromise = mongoose.connect(finalUri, { serverSelectionTimeoutMS: 10000 });

  try {
    await dbPromise;
  } catch (err) {
    dbPromise = null;
    throw err;
  }
};
