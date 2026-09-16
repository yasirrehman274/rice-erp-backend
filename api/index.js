import app from "../app.js";
import { connectDB } from "../config/db.js";

let dbPromise = null;

const ensureDb = (req, res, next) => {
  if (dbPromise) {
    dbPromise.then(() => next()).catch(next);
    return;
  }

  dbPromise = connectDB()
    .then(() => next())
    .catch((err) => {
      dbPromise = null;
      next(err);
    });
};

export default function handler(req, res) {
  // OPTIONS preflight never needs the database. Let Express CORS respond
  // immediately with proper headers instead of blocking on the DB connect.
  if (req.method === "OPTIONS") {
    return app(req, res);
  }

  ensureDb(req, res, (err) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "Database connection failed." }));
    }
    return app(req, res);
  });
}