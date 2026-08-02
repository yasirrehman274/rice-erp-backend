import Product from "../models/Product.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";

function sanitizeBody(body = {}) {
  const { id, _id, currentStock, warehouseCount, ...rest } = body;
  return rest;
}

export async function getAllProducts(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ productName: regex }, { riceCode: regex }, { category: regex }, { brand: regex }, { variety: regex }];
  }
  const products = await Product.find(query).sort({ createdDate: -1, productName: 1 });
  res.status(200).json(products);
}

export async function getProductById(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return res.status(404).json({ message: "Product not found." });
  }
  res.status(200).json(product);
}

export async function createProduct(req, res) {
  const { id } = req.body;
  const product = await Product.create({ _id: id, ...sanitizeBody(req.body) });
  res.status(201).json(product);
}

export async function updateProduct(req, res) {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    sanitizeBody(req.body),
    { new: true, runValidators: true },
  );
  if (!product) {
    return res.status(404).json({ message: "Product not found." });
  }
  res.status(200).json(product);
}

export async function deleteProduct(req, res) {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) {
    return res.status(404).json({ message: "Product not found." });
  }
  res.status(200).json({ message: "Product deleted." });
}

export async function getProductMovements(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return res.status(404).json({ message: "Product not found." });
  }
  const [purchases, sales] = await Promise.all([
    Purchase.find({ productId: product._id }).sort({ purchaseDate: -1 }).limit(10).lean(),
    Sale.find({ productId: product._id }).sort({ saleDate: -1 }).limit(10).lean(),
  ]);
  res.status(200).json({
    purchases: purchases.map((p) => ({
      id: p._id,
      date: p.purchaseDate,
      reference: p.purchaseNumber,
      party: p.supplierName,
      quantity: `${p.quantity} bags`,
      amount: p.grandTotal,
      status: p.status === "received" ? "Completed" : "Pending",
    })),
    sales: sales.map((s) => ({
      id: s._id,
      date: s.saleDate,
      reference: s.saleNumber,
      party: s.customerName,
      quantity: `${s.quantity} bags`,
      amount: s.grandTotal,
      status: s.status === "dispatched" ? "Completed" : "Pending",
    })),
  });
}
