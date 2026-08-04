import Sale from "../models/Sale.js";
import Customer from "../models/Customer.js";
import Warehouse from "../models/Warehouse.js";
import Product from "../models/Product.js";
import InventoryItem from "../models/InventoryItem.js";
import {
  today,
  incrementInventory,
  consumeInventory,
  syncProductStock,
  syncWarehouseStats,
} from "./stockHelpers.js";

function sanitizeBody(body = {}) {
  const { id, _id, customerName, warehouseName, productName, payments, ...rest } = body;
  return rest;
}

function legacyPayments(sale) {
  if (Array.isArray(sale.payments) && sale.payments.length > 0) return sale.payments;
  if (sale.receivedAmount <= 0) return [];
  return [{
    id: `pay-${sale._id}-initial`,
    saleId: sale._id,
    date: sale.saleDate,
    amount: sale.receivedAmount,
    method: sale.paymentMethod,
    reference: `PAY-${sale.saleNumber.slice(-4)}-INITIAL`,
    notes: "Initial payment received.",
  }];
}

function paymentBasedStatus(sale) {
  if (sale.status === "cancelled") return "cancelled";
  if (sale.grandTotal > 0 && sale.receivedAmount >= sale.grandTotal) return "paid";
  if (sale.receivedAmount > 0) return "partial";
  return sale.status;
}

async function resolveNames(body) {
  const [customer, warehouse, product] = await Promise.all([
    body.customerId ? Customer.findById(body.customerId).lean() : null,
    body.warehouseId ? Warehouse.findById(body.warehouseId).lean() : null,
    body.productId ? Product.findById(body.productId).lean() : null,
  ]);
  return {
    customerName: customer?.name ?? "",
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
    const price = Number(item.currentSalePrice) || 0;
    return {
      id: item.id || `itm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productId: item.productId ?? "",
      productName: names.get(item.productId) ?? item.productName ?? "",
      quantity,
      bagWeight,
      totalWeight: quantity * bagWeight,
      currentSalePrice: price,
      saleRate: bagWeight ? price / bagWeight : 0,
      subtotal: quantity * price,
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
      currentSalePrice: doc.currentSalePrice,
      saleRate: doc.saleRate,
      subtotal: doc.subtotal,
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
  const receivedAmount = Number(body.receivedAmount) || 0;
  const first = items[0];
  return {
    items,
    productId: first.productId,
    productName: first.productName,
    quantity: first.quantity,
    bagWeight: first.bagWeight,
    totalWeight: first.totalWeight,
    currentSalePrice: first.currentSalePrice,
    saleRate: first.saleRate,
    subtotal,
    grandTotal,
    remainingBalance: grandTotal - receivedAmount,
  };
}

function assertStock(doc) {
  return {
    async check() {
      if (!doc.warehouseId) return;
      const quantities = {};
      for (const item of effectiveItems(doc)) {
        if (!item.productId || item.quantity <= 0) continue;
        quantities[item.productId] = (quantities[item.productId] || 0) + item.quantity;
      }
      for (const productId of Object.keys(quantities)) {
        const inventoryItem = await InventoryItem.findOne({ productId, warehouseId: doc.warehouseId });
        const available = inventoryItem ? inventoryItem.currentStock - inventoryItem.reservedStock : 0;
        if (available < quantities[productId]) {
          const product = await Product.findById(productId).lean();
          const error = new Error(`Insufficient stock available for ${product?.productName || productId}. Requested: ${quantities[productId]}, Available: ${available}`);
          error.status = 400;
          throw error;
        }
      }
    },
  };
}

async function applySale(doc) {
  await assertStock(doc).check();
  if (doc.customerId && doc.grandTotal > 0) {
    await Customer.updateOne(
      { _id: doc.customerId },
      {
        $inc: {
          currentBalance: doc.grandTotal - doc.receivedAmount,
          totalOrders: doc.grandTotal,
          totalPayments: doc.receivedAmount,
        },
      },
    );
  }
  for (const item of effectiveItems(doc)) {
    if (item.productId && doc.warehouseId && item.quantity > 0) {
      await consumeInventory({
        productId: item.productId,
        warehouseId: doc.warehouseId,
        quantity: item.quantity,
        productName: item.productName,
      });
      await syncProductStock(item.productId);
      await syncWarehouseStats(doc.warehouseId);
    }
    if (item.productId && item.currentSalePrice > 0) {
      await Product.updateOne({ _id: item.productId }, { $set: { suggestedSalePrice: item.currentSalePrice } });
    }
  }
}

async function reverseSale(doc) {
  if (doc.customerId && doc.grandTotal > 0) {
    await Customer.updateOne(
      { _id: doc.customerId },
      {
        $inc: {
          currentBalance: -(doc.grandTotal - doc.receivedAmount),
          totalOrders: -doc.grandTotal,
          totalPayments: -doc.receivedAmount,
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
        avgCostRate: 0,
        date: doc.saleDate,
      });
      await syncProductStock(item.productId);
      await syncWarehouseStats(doc.warehouseId);
    }
  }
}

export async function getAllSales(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ saleNumber: regex }, { customerName: regex }, { productName: regex }];
  }
  const sales = await Sale.find(query).sort({ saleDate: -1, createdAt: -1 });
  res.status(200).json(sales);
}

export async function getSaleById(req, res) {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ message: "Sale not found." });
  }
  res.status(200).json(sale);
}

export async function createSale(req, res) {
  const { id } = req.body;
  const body = sanitizeBody(req.body);
  const items = await normalizeItems(body);
  const computed = items ? computedFromItems(items, body) : {};
  await assertStock({
    warehouseId: body.warehouseId,
    items: items ?? [],
    productId: body.productId,
    quantity: Number(body.quantity) || 0,
    ...computed,
  }).check();
  const names = await resolveNames(body);
  const initialReceived = Number(body.receivedAmount) || 0;
  body.status = paymentBasedStatus({ ...body, ...computed, receivedAmount: initialReceived });
  const payments = initialReceived > 0 ? [{
    id: `pay-${id}-initial`, saleId: id, date: body.saleDate, amount: initialReceived,
    method: body.paymentMethod ?? "cash", reference: `PAY-${String(body.saleNumber).slice(-4)}-INITIAL`, notes: "Initial payment received.",
  }] : [];
  const sale = await Sale.create({ _id: id, ...body, ...computed, ...names, payments });
  await applySale(sale);
  res.status(201).json(sale);
}

export async function importSale(req, res) {
  const { id, _id, ...rest } = req.body;
  const sale = await Sale.create({ _id: id ?? _id, ...rest });
  res.status(201).json(sale);
}

export async function updateSale(req, res) {
  const old = await Sale.findById(req.params.id);
  if (!old) {
    return res.status(404).json({ message: "Sale not found." });
  }
  const body = sanitizeBody(req.body);
  const items = await normalizeItems(body);
  const computed = items ? computedFromItems(items, body) : {};
  await assertStock({
    warehouseId: body.warehouseId,
    items: items ?? [],
    productId: body.productId,
    quantity: Number(body.quantity) || 0,
    ...computed,
  }).check();
  const names = await resolveNames(body);
  body.status = paymentBasedStatus({ ...body, ...computed });
  await reverseSale(old);
  const sale = await Sale.findByIdAndUpdate(
    req.params.id,
    { ...body, ...computed, ...names, updatedAt: today() },
    { new: true, runValidators: true },
  );
  await applySale(sale);
  res.status(200).json(sale);
}

export async function deleteSale(req, res) {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ message: "Sale not found." });
  }
  await reverseSale(sale);
  await Sale.findByIdAndDelete(sale._id);
  res.status(200).json({ message: "Sale deleted." });
}

export async function getSalePayments(req, res) {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ message: "Sale not found." });
  }
  res.status(200).json(legacyPayments(sale));
}

export async function addSalePayment(req, res) {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ message: "Sale not found." });
  }
  const { amount, method = "cash", notes = "" } = req.body ?? {};
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return res.status(400).json({ message: "Payment amount must be greater than zero." });
  }
  if (numAmount > sale.remainingBalance) {
    return res.status(400).json({ message: "Payment amount exceeds the outstanding balance." });
  }
  const receivedAmount = sale.receivedAmount + numAmount;
  const paymentStatus = receivedAmount >= sale.grandTotal ? "paid" : "partial";
  const payments = [...legacyPayments(sale), {
    id: `pay-${sale._id}-${Date.now()}`,
    saleId: sale._id,
    date: today(),
    amount: numAmount,
    method,
    reference: `PAY-${sale.saleNumber.slice(-4)}-${legacyPayments(sale).length + 1}`,
    notes,
  }];
  const updated = await Sale.findByIdAndUpdate(
    sale._id,
    {
      $set: {
        receivedAmount,
        remainingBalance: sale.grandTotal - receivedAmount,
        paymentStatus,
        status: receivedAmount >= sale.grandTotal ? "paid" : "partial",
        paymentMethod: method,
        payments,
        notes: sale.notes,
        updatedAt: today(),
      },
    },
    { new: true },
  );
  if (sale.customerId) {
    await Customer.updateOne(
      { _id: sale.customerId },
      { $inc: { currentBalance: -numAmount, totalPayments: numAmount } },
    );
  }
  res.status(200).json(updated);
}

export async function dispatchSale(req, res) {
  const sale = await Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ message: "Sale not found." });
  }
  const { dispatchedBy = "", notes = "" } = req.body ?? {};
  const updated = await Sale.findByIdAndUpdate(
    sale._id,
    {
      $set: {
        status: "dispatched",
        dispatchedDate: today(),
        dispatchedBy,
        notes: notes || sale.notes,
        updatedAt: today(),
      },
    },
    { new: true },
  );
  res.status(200).json(updated);
}

export async function getSaleHistory(req, res) {
  const sales = await Sale.find({}).sort({ saleDate: -1, createdAt: -1 }).lean();
  res.status(200).json(
    sales.map((s) => ({
      id: s._id,
      saleId: s._id,
      saleNumber: s.saleNumber,
      date: s.saleDate,
      customerName: s.customerName,
      productName: s.productName,
      quantity: s.quantity,
      amount: s.grandTotal,
      status: s.status,
      paymentStatus: s.paymentStatus,
    })),
  );
}
