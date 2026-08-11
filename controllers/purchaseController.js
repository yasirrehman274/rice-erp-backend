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
  const { id, _id, supplierName, warehouseName, productName, payments, ...rest } = body;
  return rest;
}

function legacyPayments(purchase) {
  if (Array.isArray(purchase.payments) && purchase.payments.length > 0) return purchase.payments;
  if (purchase.paidAmount <= 0) return [];
  const payments = [];
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
  return payments;
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

async function normalizeItems(body) {
  const raw = Array.isArray(body.items) && body.items.length > 0 ? body.items : null;
  if (!raw) return null;
  const ids = [...new Set(raw.map((item) => item.productId).filter(Boolean))];
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const names = new Map(products.map((product) => [product._id, product.productName]));
  return raw.map((item) => {
    const quantity = Number(item.quantity) || 0;
    const bagWeight = Number(item.bagWeight) || 0;
    const price = Number(item.currentPurchasePrice) || 0;
    const totalWeight = quantity * bagWeight;
    return {
      id: item.id || `itm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productId: item.productId ?? "",
      productName: names.get(item.productId) ?? item.productName ?? "",
      quantity,
      bagWeight,
      totalWeight,
      currentPurchasePrice: price,
      purchaseRate: totalWeight > 0 ? (price * quantity) / totalWeight : 0,
      subtotal: quantity * price,
      batchNumber: item.batchNumber ?? "",
      riceVariety: item.riceVariety ?? "",
    };
  });
}

function effectiveItems(doc) {
  if (Array.isArray(doc.items) && doc.items.length > 0) return doc.items;
  if (doc.productId && doc.quantity > 0) {
    return [{
      id: `itm-${doc._id}-1`,
      productId: doc.productId,
      productName: doc.productName,
      quantity: doc.quantity,
      bagWeight: doc.bagWeight,
      totalWeight: doc.totalWeight,
      currentPurchasePrice: doc.currentPurchasePrice,
      purchaseRate: doc.purchaseRate,
      subtotal: doc.subtotal,
      batchNumber: doc.batchNumber ?? "",
      riceVariety: doc.riceVariety ?? "",
    }];
  }
  return [];
}

function computedFromItems(items, body) {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Number(body.discount) || 0;
  const shipping = Number(body.transportCharges) || 0;
  const other = Number(body.otherCharges) || 0;
  const grandTotal = subtotal - discount + shipping + other;
  const paidAmount = Number(body.paidAmount) || 0;
  const first = items[0];
  return {
    items,
    productId: first.productId,
    productName: first.productName,
    batchNumber: first.batchNumber,
    riceVariety: first.riceVariety,
    quantity: first.quantity,
    bagWeight: first.bagWeight,
    totalWeight: first.totalWeight,
    currentPurchasePrice: first.currentPurchasePrice,
    purchaseRate: first.purchaseRate,
    subtotal,
    grandTotal,
    remainingBalance: grandTotal - paidAmount,
  };
}

function purchaseSummary(doc) {
  const items = effectiveItems(doc);
  const totalBags = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const name = items.length > 1
    ? `${items[0].productName} +${items.length - 1} more`
    : (items[0]?.productName ?? doc.productName ?? "");
  return { productName: name, quantity: totalBags };
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
  for (const item of effectiveItems(doc)) {
    if (item.productId && doc.warehouseId && item.quantity > 0) {
      await incrementInventory({
        productId: item.productId,
        warehouseId: doc.warehouseId,
        quantity: item.quantity,
        avgCostRate: item.purchaseRate,
        date: doc.purchaseDate,
      });
      await syncProductStock(item.productId);
      await syncWarehouseStats(doc.warehouseId);
    }
    if (item.productId && item.currentPurchasePrice > 0) {
      await Product.updateOne({ _id: item.productId }, { $set: { lastPurchasePrice: item.currentPurchasePrice } });
    }
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
  for (const item of effectiveItems(doc)) {
    if (item.productId && doc.warehouseId && item.quantity > 0) {
      await decrementInventory({
        productId: item.productId,
        warehouseId: doc.warehouseId,
        quantity: item.quantity,
      });
      await syncProductStock(item.productId);
      await syncWarehouseStats(doc.warehouseId);
    }
  }
}

export async function getAllPurchases(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [
      { purchaseNumber: regex },
      { supplierName: regex },
      { productName: regex },
      { "items.productName": regex },
    ];
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
  const items = await normalizeItems(body);
  const computed = items ? computedFromItems(items, body) : {};
  const names = await resolveNames(body);
  const purchase = await Purchase.create({ _id: id, ...body, ...computed, ...names });
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
  const items = await normalizeItems(body);
  const computed = items ? computedFromItems(items, body) : {};
  const names = await resolveNames(body);
  const purchase = await Purchase.findByIdAndUpdate(
    req.params.id,
    { ...body, ...computed, ...names, updatedAt: today() },
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
  res.status(200).json(legacyPayments(purchase));
}

export async function addPurchasePayment(req, res) {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  const { amount, method = "cash", notes = "", createdBy = "" } = req.body ?? {};
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return res.status(400).json({ message: "Payment amount must be greater than zero." });
  }
  if (numAmount > purchase.remainingBalance) {
    return res.status(400).json({ message: "Payment amount exceeds the outstanding balance." });
  }
  const paidAmount = purchase.paidAmount + numAmount;
  const paymentStatus = paidAmount >= purchase.grandTotal ? "paid" : "partial";
  const existing = legacyPayments(purchase);
  const now = today();
  const payments = [
    ...existing,
    {
      id: `pay-${purchase._id}-${Date.now()}`,
      purchaseId: purchase._id,
      date: now,
      amount: numAmount,
      method,
      reference: `PAY-${purchase.purchaseNumber.slice(-4)}-${existing.length + 1}`,
      notes,
      createdBy,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const updated = await Purchase.findByIdAndUpdate(
    purchase._id,
    {
      $set: {
        paidAmount,
        remainingBalance: purchase.grandTotal - paidAmount,
        paymentStatus,
        paymentMethod: method,
        payments,
        notes: purchase.notes,
        updatedAt: now,
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

export async function updatePurchasePayment(req, res) {
  const { id, paymentId } = req.params;
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  const payments = Array.isArray(purchase.payments) ? [...purchase.payments] : [];
  const index = payments.findIndex((p) => p.id === paymentId);
  if (index === -1) {
    return res.status(404).json({ message: "Payment not found." });
  }
  const old = payments[index];
  const { amount, date, method = old.method, reference = old.reference, notes = old.notes, createdBy = old.createdBy ?? "" } =
    req.body ?? {};
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return res.status(400).json({ message: "Payment amount must be greater than zero." });
  }
  const paidAmount = purchase.paidAmount - old.amount + numAmount;
  if (paidAmount > purchase.grandTotal) {
    return res.status(400).json({ message: "Payment amount exceeds the outstanding balance." });
  }
  const paymentStatus = paidAmount >= purchase.grandTotal ? "paid" : "partial";
  const now = today();
  payments[index] = {
    ...old,
    date: date || old.date,
    amount: numAmount,
    method,
    reference: reference || old.reference,
    notes,
    createdBy,
    updatedAt: now,
  };
  const diff = numAmount - old.amount;
  const updated = await Purchase.findByIdAndUpdate(
    purchase._id,
    {
      $set: {
        paidAmount,
        remainingBalance: purchase.grandTotal - paidAmount,
        paymentStatus,
        paymentMethod: method,
        payments,
        notes: purchase.notes,
        updatedAt: now,
      },
    },
    { new: true },
  );
  if (purchase.supplierId && diff !== 0) {
    await Supplier.updateOne(
      { _id: purchase.supplierId },
      { $inc: { currentBalance: -diff, totalPaid: diff } },
    );
  }
  res.status(200).json(updated);
}

export async function deletePurchasePayment(req, res) {
  const { id, paymentId } = req.params;
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    return res.status(404).json({ message: "Purchase not found." });
  }
  const payments = Array.isArray(purchase.payments) ? [...purchase.payments] : [];
  const index = payments.findIndex((p) => p.id === paymentId);
  if (index === -1) {
    return res.status(404).json({ message: "Payment not found." });
  }
  const removed = payments[index];
  const paidAmount = Math.max(0, purchase.paidAmount - removed.amount);
  const paymentStatus = paidAmount >= purchase.grandTotal ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
  const updated = await Purchase.findByIdAndUpdate(
    purchase._id,
    {
      $set: {
        paidAmount,
        remainingBalance: purchase.grandTotal - paidAmount,
        paymentStatus,
        payments: payments.filter((p) => p.id !== paymentId),
        updatedAt: today(),
      },
    },
    { new: true },
  );
  if (purchase.supplierId) {
    await Supplier.updateOne(
      { _id: purchase.supplierId },
      { $inc: { currentBalance: removed.amount, totalPaid: -removed.amount } },
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
    purchases.map((p) => {
      const summary = purchaseSummary(p);
      return {
        id: p._id,
        purchaseId: p._id,
        purchaseNumber: p.purchaseNumber,
        date: p.purchaseDate,
        supplierName: p.supplierName,
        productName: summary.productName,
        quantity: summary.quantity,
        amount: p.grandTotal,
        status: p.status,
        paymentStatus: p.paymentStatus,
      };
    }),
  );
}
