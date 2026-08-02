import Purchase from "../models/Purchase.js";
import Supplier from "../models/Supplier.js";
import Warehouse from "../models/Warehouse.js";
import Product from "../models/Product.js";
import {
  today,
  incrementInventory,
  decrementInventory,
  syncProductStock,
  syncWarehouseStats,
} from "./stockHelpers.js";

function sanitizeBody(body = {}) {
  const { id, _id, supplierName, warehouseName, productName, ...rest } = body;
  return rest;
}

async function resolveNames(body) {
  const [supplier, warehouse, product] = await Promise.all([
    body.supplierId ? Supplier.findById(body.supplierId).lean() : null,
    body.warehouseId ? Warehouse.findById(body.warehouseId).lean() : null,
    body.productId ? Product.findById(body.productId).lean() : null,
  ]);
  return {
    supplierName: supplier?.name ?? "",
    warehouseName: warehouse?.name ?? "",
    productName: product?.productName ?? "",
  };
}

async function applyPurchase(doc) {
  if (doc.supplierId && doc.grandTotal > 0) {
    await Supplier.updateOne(
      { _id: doc.supplierId },
      {
        $inc: {
          currentBalance: doc.grandTotal - doc.paidAmount,
          totalPurchases: doc.grandTotal,
          totalPaid: doc.paidAmount,
        },
      },
    );
  }
  if (doc.productId && doc.warehouseId && doc.quantity > 0) {
    await incrementInventory({
      productId: doc.productId,
      warehouseId: doc.warehouseId,
      quantity: doc.quantity,
      avgCostRate: doc.purchaseRate,
      date: doc.purchaseDate,
    });
    await syncProductStock(doc.productId);
    await syncWarehouseStats(doc.warehouseId);
  }
  if (doc.productId && doc.currentPurchasePrice > 0) {
    await Product.updateOne({ _id: doc.productId }, { $set: { lastPurchasePrice: doc.currentPurchasePrice } });
  }
}

async function reversePurchase(doc) {
  if (doc.supplierId && doc.grandTotal > 0) {
    await Supplier.updateOne(
      { _id: doc.supplierId },
      {
        $inc: {
          currentBalance: -(doc.grandTotal - doc.paidAmount),
          totalPurchases: -doc.grandTotal,
          totalPaid: -doc.paidAmount,
        },
      },
    );
  }
  if (doc.productId && doc.warehouseId && doc.quantity > 0) {
    await decrementInventory({
      productId: doc.productId,
      warehouseId: doc.warehouseId,
      quantity: doc.quantity,
    });
    await syncProductStock(doc.productId);
    await syncWarehouseStats(doc.warehouseId);
  }
}

export async function getAllPurchases(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ purchaseNumber: regex }, { supplierName: regex }, { productName: regex }];
  }
  const purchases = await Purchase.find(query).sort({ purchaseDate: -1, createdAt: -1 });
  res.status(200).json(purchases);
}

export async function getPurchaseById(req, res) {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  res.status(200).json(purchase);
}

export async function createPurchase(req, res) {
  const { id } = req.body;
  const body = sanitizeBody(req.body);
  const names = await resolveNames(body);
  const purchase = await Purchase.create({ _id: id, ...body, ...names });
  await applyPurchase(purchase);
  res.status(201).json(purchase);
}

export async function importPurchase(req, res) {
  const { id, _id, ...rest } = req.body;
  const purchase = await Purchase.create({ _id: id ?? _id, ...rest });
  res.status(201).json(purchase);
}

export async function updatePurchase(req, res) {
  const old = await Purchase.findById(req.params.id);
  if (!old) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  const body = sanitizeBody(req.body);
  const names = await resolveNames(body);
  const purchase = await Purchase.findByIdAndUpdate(
    req.params.id,
    { ...body, ...names, updatedAt: today() },
    { new: true, runValidators: true },
  );
  await reversePurchase(old);
  await applyPurchase(purchase);
  res.status(200).json(purchase);
}

export async function deletePurchase(req, res) {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  await reversePurchase(purchase);
  await Purchase.findByIdAndDelete(purchase._id);
  res.status(200).json({ message: "Purchase deleted." });
}

export async function getPurchasePayments(req, res) {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  const payments = [];
  if (purchase.paidAmount === 0) return res.status(200).json(payments);
  let remaining = purchase.paidAmount;
  if (remaining >= purchase.grandTotal * 0.5) {
    const firstAmount = Math.round(purchase.grandTotal * 0.5);
    payments.push({
      id: `pay-${purchase._id}-01`,
      purchaseId: purchase._id,
      date: purchase.purchaseDate,
      amount: firstAmount,
      method: purchase.paymentMethod,
      reference: `PAY-${purchase.purchaseNumber.slice(-4)}-01`,
      notes: "Initial advance payment.",
    });
    remaining -= firstAmount;
  }
  if (remaining > 0) {
    payments.push({
      id: `pay-${purchase._id}-02`,
      purchaseId: purchase._id,
      date: purchase.updatedAt,
      amount: remaining,
      method: purchase.paymentMethod,
      reference: `PAY-${purchase.purchaseNumber.slice(-4)}-02`,
      notes: "Balance payment.",
    });
  }
  res.status(200).json(payments);
}

export async function addPurchasePayment(req, res) {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  const { amount, method = "cash", notes = "" } = req.body ?? {};
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return res.status(400).json({ message: "Payment amount must be greater than zero." });
  }
  if (numAmount > purchase.remainingBalance) {
    return res.status(400).json({ message: "Payment amount exceeds the outstanding balance." });
  }
  const paidAmount = purchase.paidAmount + numAmount;
  const paymentStatus = paidAmount >= purchase.grandTotal ? "paid" : "partial";
  const updated = await Purchase.findByIdAndUpdate(
    purchase._id,
    {
      $set: {
        paidAmount,
        remainingBalance: purchase.grandTotal - paidAmount,
        paymentStatus,
        paymentMethod: method,
        notes: purchase.notes,
        updatedAt: today(),
      },
    },
    { new: true },
  );
  if (purchase.supplierId) {
    await Supplier.updateOne(
      { _id: purchase.supplierId },
      { $inc: { currentBalance: -numAmount, totalPaid: numAmount } },
    );
  }
  res.status(200).json(updated);
}

export async function receivePurchase(req, res) {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  const { receivedBy = "", notes = "" } = req.body ?? {};
  const updated = await Purchase.findByIdAndUpdate(
    purchase._id,
    {
      $set: {
        status: "received",
        receivedDate: today(),
        receivedBy,
        notes: notes || purchase.notes,
        updatedAt: today(),
      },
    },
    { new: true },
  );
  res.status(200).json(updated);
}

export async function getPurchaseHistory(req, res) {
  const purchases = await Purchase.find({}).sort({ purchaseDate: -1, createdAt: -1 }).lean();
  res.status(200).json(
    purchases.map((p) => ({
      id: p._id,
      purchaseId: p._id,
      purchaseNumber: p.purchaseNumber,
      date: p.purchaseDate,
      supplierName: p.supplierName,
      productName: p.productName,
      quantity: p.quantity,
      amount: p.grandTotal,
      status: p.status,
      paymentStatus: p.paymentStatus,
    })),
  );
}
