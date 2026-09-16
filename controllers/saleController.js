import Sale from "../models/Sale.js";
import Customer from "../models/Customer.js";
import Broker from "../models/Broker.js";
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

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function calculateSaleProfit(saleDoc, items) {
  const warehouseId = saleDoc.warehouseId;
  if (!warehouseId || !items || items.length === 0) {
    return { costOfGoodsSold: 0, grossProfit: 0, profitMargin: 0, items };
  }
  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length === 0) {
    return { costOfGoodsSold: 0, grossProfit: 0, profitMargin: 0, items };
  }
  const inventoryItems = await InventoryItem.find({
    productId: { $in: productIds },
    warehouseId,
  }).lean();
  const costMap = new Map(inventoryItems.map((i) => [i.productId, Number(i.averageCostPerKG) || 0]));
  let totalCOGS = 0;
  const updatedItems = items.map((item) => {
    const costPerKG = costMap.get(item.productId) ?? 0;
    const bagWeight = Number(item.bagWeight) || 0;
    const quantity = Number(item.quantity) || 0;
    const unitCostPerBag = round2(costPerKG * bagWeight);
    const itemCOGS = round2(quantity * unitCostPerBag);
    const itemProfit = round2(item.subtotal - itemCOGS);
    totalCOGS += itemCOGS;
    return { ...item, unitCostPerBag, itemCOGS, itemProfit };
  });
  const grandTotal = Number(saleDoc.grandTotal) || 0;
  const grossProfit = round2(grandTotal - totalCOGS);
  const profitMargin = grandTotal > 0 ? round2((grossProfit / grandTotal) * 100) : 0;
  return { costOfGoodsSold: round2(totalCOGS), grossProfit, profitMargin, items: updatedItems };
}

function sanitizeBody(body = {}) {
  const { id, _id, customerName, warehouseName, productName, displayProductName, brokerName, payments, ...rest } = body;
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
  const [customer, warehouse, product, broker] = await Promise.all([
    body.customerId ? Customer.findById(body.customerId).lean() : null,
    body.warehouseId ? Warehouse.findById(body.warehouseId).lean() : null,
    body.productId ? Product.findById(body.productId).lean() : null,
    body.brokerId ? Broker.findById(body.brokerId).lean() : null,
  ]);
  return {
    customerName: customer?.name ?? "",
    warehouseName: warehouse?.name ?? "",
    productName: product?.productName ?? "",
    brokerName: broker?.name ?? "",
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
    const actualName = names.get(item.productId) ?? item.productName ?? "";
    return {
      id: item.id || `itm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productId: item.productId ?? "",
      productName: actualName,
      displayProductName: String(item.displayProductName ?? "").trim() || actualName,
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
      displayProductName: doc.displayProductName || doc.productName || "",
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
    displayProductName: first.displayProductName || first.productName || "",
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
    query.$or = [
      { saleNumber: regex },
      { customerName: regex },
      { brokerName: regex },
      { productName: regex },
      { displayProductName: regex },
      { "items.productName": regex },
      { "items.displayProductName": regex },
    ];
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
  if (!items) body.displayProductName = names.productName;
  const initialReceived = Number(body.receivedAmount) || 0;
  body.status = paymentBasedStatus({ ...body, ...computed, receivedAmount: initialReceived });
  const payments = initialReceived > 0 ? [{
    id: `pay-${id}-initial`, saleId: id, date: body.saleDate, amount: initialReceived,
    method: body.paymentMethod ?? "cash", reference: `PAY-${String(body.saleNumber).slice(-4)}-INITIAL`, notes: "Initial payment received.",
  }] : [];
  const sale = await Sale.create({ _id: id, ...body, ...computed, ...names, payments });
  await applySale(sale);
  const saleDoc = await Sale.findById(id);
  const itemsForProfit = effectiveItems(saleDoc);
  const profit = await calculateSaleProfit(saleDoc, itemsForProfit);
  const updated = await Sale.findByIdAndUpdate(
    id,
    { $set: { costOfGoodsSold: profit.costOfGoodsSold, grossProfit: profit.grossProfit, profitMargin: profit.profitMargin, items: profit.items, updatedAt: today() } },
    { new: true },
  );
  res.status(201).json(updated);
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
  if (!items) body.displayProductName = names.productName;
  body.status = paymentBasedStatus({ ...body, ...computed });
  await reverseSale(old);
  const sale = await Sale.findByIdAndUpdate(
    req.params.id,
    { ...body, ...computed, ...names, updatedAt: today() },
    { new: true, runValidators: true },
  );
  await applySale(sale);
  const saleDoc = await Sale.findById(req.params.id);
  const itemsForProfit = effectiveItems(saleDoc);
  const profit = await calculateSaleProfit(saleDoc, itemsForProfit);
  const updated = await Sale.findByIdAndUpdate(
    req.params.id,
    { $set: { costOfGoodsSold: profit.costOfGoodsSold, grossProfit: profit.grossProfit, profitMargin: profit.profitMargin, items: profit.items, updatedAt: today() } },
    { new: true },
  );
  res.status(200).json(updated);
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
      brokerName: s.brokerName,
      productName: s.productName,
      displayProductName: s.displayProductName || s.productName,
      quantity: s.quantity,
      amount: s.grandTotal,
      status: s.status,
      paymentStatus: s.paymentStatus,
    })),
  );
}
