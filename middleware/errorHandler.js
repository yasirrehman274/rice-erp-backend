export function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found.` });
}

export function errorHandler(err, req, res, next) {
  if (err?.name === "ValidationError") {
    const message = Object.values(err.errors ?? {})
      .map((e) => e.message)
      .join(" ");
    return res.status(400).json({ message });
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? "record";
    return res.status(409).json({ message: `This ${field} is already in use.` });
  }
  if (err?.status) {
    return res.status(err.status).json({ message: err.message });
  }
  console.error(err);
  return res.status(500).json({ message: "Server error. Please try again." });
}
