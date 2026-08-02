import Sale from "../models/Sale.js";
import Customer from "../models/Customer.js";
import Warehouse from "../models/Warehouse.js";
import Product from "../models/Product.js";
import InventoryItem from "../models/InventoryItem.js";
import {
  today,
  incrementInventory,
  decrementInventory,
  syncProductStock,
  syncWarehouseStats,
} from "./stockHelpers.js";

function sanitizeBody(body = {}) {
  const { id, _id, customerName, warehouseName, productName, ...rest } = body;
  return rest;
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

function assertStock(doc) {
  return {
    async check() {
      if (!doc.productId || !doc.warehouseId || doc.quantity <= 0) return;
      const item = await InventoryItem.findOne({ productId: doc.productId, warehouseId: doc.warehouseId });
      const available = item ? item.currentStock - item.reservedStock : 0;
      if (available < doc.quantity) {
        const error = new Error(`Insufficient stock available. Requested: ${doc.quantity}, Available: ${available}`);
        error.status = 400;
        throw error;
      }
    },
  };
}

async function applySale(doc) {
  if (doc.productId && doc.warehouseId && doc.quantity > 0) {
    await assertStock(doc).check();
  }
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
  if (doc.productId && doc.warehouseId && doc.quantity > 0) {
    await decrementInventory({
      productId: doc.productId,
      warehouseId: doc.warehouseId,
      quantity: doc.quantity,
    });
    await syncProductStock(doc.productId);
    await syncWarehouseStats(doc.warehouseId);
  }
  if (doc.productId && doc.currentSalePrice > 0) {
    await Product.updateOne({ _id: doc.productId }, { $set: { suggestedSalePrice: doc.currentSalePrice } });
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
  if (doc.productId && doc.warehouseId && doc.quantity > 0) {
    await incrementInventory({
      productId: doc.productId,
      warehouseId: doc.warehouseId,
      quantity: doc.quantity,
      avgCostRate: 0,
      date: doc.saleDate,
    });
    await syncProductStock(doc.productId);
    await syncWarehouseStats(doc.warehouseId);
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
  const names = await resolveNames(body);
  const sale = await Sale.create({ _id: id, ...body, ...names });
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
  const names = await resolveNames(body);
  await reverseSale(old);
  const sale = await Sale.findByIdAndUpdate(
    req.params.id,
    { ...body, ...names, updatedAt: today() },
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
  const payments = [];
  if (sale.receivedAmount === 0) return res.status(200).json(payments);
  let remaining = sale.receivedAmount;
  if (remaining >= sale.grandTotal * 0.5) {
    const firstAmount = Math.round(sale.grandTotal * 0.5);
    payments.push({
      id: `pay-${sale._id}-01`,
      saleId: sale._id,
      date: sale.saleDate,
      amount: firstAmount,
      method: sale.paymentMethod,
      reference: `PAY-${sale.saleNumber.slice(-4)}-01`,
      notes: "Initial advance received.",
    });
    remaining -= firstAmount;
  }
  if (remaining > 0) {
    payments.push({
      id: `pay-${sale._id}-02`,
      saleId: sale._id,
      date: sale.updatedAt,
      amount: remaining,
      method: sale.paymentMethod,
      reference: `PAY-${sale.saleNumber.slice(-4)}-02`,
      notes: "Balance payment received.",
    });
  }
  res.status(200).json(payments);
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
  const updated = await Sale.findByIdAndUpdate(
    sale._id,
    {
      $set: {
        receivedAmount,
        remainingBalance: sale.grandTotal - receivedAmount,
        paymentStatus,
        paymentMethod: method,
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
