import app from "../app.js";
import { connectDB } from "../config/db.js";

let dbPromise = null;

const ensureDb = async (req, res, next) => {
  if (dbPromise) {
    await dbPromise;
    return next();
  }

  dbPromise = connectDB(process.env.MONGO_URI);

  try {
    await dbPromise;
    next();
  } catch (err) {
    dbPromise = null;
    next(err);
  }
};

export default async function handler(req, res) {
  try {
    await new Promise((resolve, reject) => {
      ensureDb(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    return res.status(500).json({ message: "Database connection failed." });
  }

  return app(req, res);
}
