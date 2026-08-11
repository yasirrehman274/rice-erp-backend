import InventoryItem from "../models/InventoryItem.js";
import InventoryAdjustment from "../models/InventoryAdjustment.js";
import InventoryTransfer from "../models/InventoryTransfer.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Warehouse from "../models/Warehouse.js";
import Product from "../models/Product.js";
import {
  today,
  incrementInventory,
  decrementInventory,
  syncProductStock,
  syncWarehouseStats,
} from "./stockHelpers.js";

async function nextIdFor(model, prefix) {
  const docs = await model.find({}, { _id: 1 }).lean();
  let max = 0;
  for (const doc of docs) {
    const n = parseInt(String(doc._id).split("-")[1], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export async function getAllInventory(req, res) {
  const { search, productId, warehouseId } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ productName: regex }, { riceCode: regex }, { category: regex }, { warehouseName: regex }];
  }
  if (productId) query.productId = productId;
  if (warehouseId) query.warehouseId = warehouseId;
  const items = await InventoryItem.find(query).sort({ updatedAt: -1, productName: 1 });
  res.status(200).json(items);
}

export async function getInventoryById(req, res) {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Inventory item not found." });
  }
  res.status(200).json(item);
}

export async function createInventoryItem(req, res) {
  const { id } = req.body;
  const { productId, warehouseId } = req.body;
  if (!productId || !warehouseId) {
    return res.status(400).json({ message: "Product and warehouse are required." });
  }
  const existing = await InventoryItem.findOne({ productId, warehouseId });
  const now = today();
  if (existing) {
    const updated = await InventoryItem.findByIdAndUpdate(
      existing._id,
      { $set: { ...req.body, _id: existing._id, updatedAt: now } },
      { new: true, runValidators: true },
    );
    await syncProductStock(productId);
    await syncWarehouseStats(warehouseId);
    return res.status(200).json(updated);
  }
  const item = await InventoryItem.create({
    _id: id ?? (await nextIdFor(InventoryItem, "inv")),
    ...req.body,
    reservedStock: req.body.reservedStock ?? 0,
    updatedAt: now,
  });
  await syncProductStock(productId);
  await syncWarehouseStats(warehouseId);
  res.status(201).json(item);
}

export async function recomputeAll(req, res) {
  const items = await InventoryItem.find({}, { productId: 1, warehouseId: 1 }).lean();
  const productIds = [...new Set(items.map((i) => i.productId))];
  const warehouseIds = [...new Set(items.map((i) => i.warehouseId))];
  await Promise.all([
    ...productIds.map((productId) => syncProductStock(productId)),
    ...warehouseIds.map((warehouseId) => syncWarehouseStats(warehouseId)),
  ]);
  res.status(200).json({ productCount: productIds.length, warehouseCount: warehouseIds.length });
}

export async function adjustStock(req, res) {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Inventory item not found." });
  }
  const { adjustmentType, quantity, reason = "", notes = "" } = req.body ?? {};
  const numQuantity = Number(quantity);
  if (!["increase", "decrease"].includes(adjustmentType)) {
    return res.status(400).json({ message: "Adjustment type must be 'increase' or 'decrease'." });
  }
  if (!Number.isFinite(numQuantity) || numQuantity <= 0) {
    return res.status(400).json({ message: "Quantity must be greater than zero." });
  }
  if (adjustmentType === "decrease" && numQuantity > item.currentStock) {
    return res.status(400).json({ message: `Cannot decrease more than the current stock (${item.currentStock}).` });
  }
  const delta = adjustmentType === "increase" ? numQuantity : -numQuantity;
  const updated = await InventoryItem.findByIdAndUpdate(
    item._id,
    { $inc: { currentStock: delta }, $set: { updatedAt: today() } },
    { new: true },
  );
  await InventoryAdjustment.create({
    _id: await nextIdFor(InventoryAdjustment, "adj"),
    inventoryItemId: item._id,
    productId: item.productId,
    productName: item.productName,
    warehouseId: item.warehouseId,
    warehouseName: item.warehouseName,
    adjustmentType,
    quantity: numQuantity,
    reason,
    notes,
    date: today(),
  });
  await syncProductStock(item.productId);
  await syncWarehouseStats(item.warehouseId);
  res.status(200).json(updated);
}

export async function transferStock(req, res) {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Inventory item not found." });
  }
  const { destinationWarehouseId, quantity, notes = "" } = req.body ?? {};
  const numQuantity = Number(quantity);
  if (!Number.isFinite(numQuantity) || numQuantity <= 0) {
    return res.status(400).json({ message: "Quantity must be greater than zero." });
  }
  if (!destinationWarehouseId) {
    return res.status(400).json({ message: "Destination warehouse is required." });
  }
  if (destinationWarehouseId === item.warehouseId) {
    return res.status(400).json({ message: "Destination warehouse must be different from the source warehouse." });
  }
  const available = item.currentStock - item.reservedStock;
  if (numQuantity > available) {
    return res.status(400).json({ message: `Insufficient stock available. Requested: ${numQuantity}, Available: ${available}` });
  }
  const destination = await Warehouse.findById(destinationWarehouseId);
  if (!destination) {
    return res.status(404).json({ message: "Destination warehouse not found." });
  }
  await decrementInventory({ productId: item.productId, warehouseId: item.warehouseId, quantity: numQuantity });
  await incrementInventory({
    productId: item.productId,
    warehouseId: destinationWarehouseId,
    quantity: numQuantity,
    avgCostRate: 0,
    meta: {
      productName: item.productName,
      riceCode: item.riceCode,
      category: item.category,
      warehouseName: destination.name,
      unit: item.unit,
      minimumStock: item.minimumStock,
    },
  });
  await InventoryTransfer.create({
    _id: await nextIdFor(InventoryTransfer, "trf"),
    productId: item.productId,
    productName: item.productName,
    sourceWarehouseId: item.warehouseId,
    sourceWarehouseName: item.warehouseName,
    destinationWarehouseId,
    destinationWarehouseName: destination.name,
    quantity: numQuantity,
    notes,
    date: today(),
  });
  await syncProductStock(item.productId);
  await syncWarehouseStats(item.warehouseId);
  await syncWarehouseStats(destinationWarehouseId);
  const updated = await InventoryItem.findById(item._id);
  res.status(200).json(updated);
}

export async function getStockLedger(req, res) {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Inventory item not found." });
  }
  const { productId, warehouseId } = item;
  const [purchases, sales, adjustments, transfers] = await Promise.all([
    Purchase.find({
      warehouseId,
      $or: [{ productId, quantity: { $gt: 0 } }, { "items.productId": productId }],
    })
      .select("_id purchaseNumber purchaseDate productId quantity items")
      .lean(),
    Sale.find({ productId, warehouseId, quantity: { $gt: 0 } })
      .select("_id saleNumber saleDate quantity")
      .lean(),
    InventoryAdjustment.find({ inventoryItemId: item._id }).lean(),
    InventoryTransfer.find({
      $or: [{ sourceWarehouseId: warehouseId }, { destinationWarehouseId: warehouseId }],
    }).lean(),
  ]);

  const rows = [];
  for (const p of purchases) {
    const lines = Array.isArray(p.items) && p.items.length > 0 ? p.items : [{ productId: p.productId, quantity: p.quantity }];
    for (const line of lines) {
      if (String(line.productId) !== String(productId) || !(Number(line.quantity) > 0)) continue;
      rows.push({
        id: `led-p-${p._id}-${line.productId}`,
        date: p.purchaseDate,
        type: "purchase",
        description: "Purchase receipt",
        reference: p.purchaseNumber,
        stockIn: line.quantity,
        stockOut: 0,
        sort: `${p.purchaseDate}|p|${p._id}|${line.productId}`,
      });
    }
  }
  for (const s of sales) {
    rows.push({
      id: `led-s-${s._id}`,
      date: s.saleDate,
      type: "sale",
      description: "Sales dispatch",
      reference: s.saleNumber,
      stockIn: 0,
      stockOut: s.quantity,
      sort: `${s.saleDate}|s|${s._id}`,
    });
  }
  for (const a of adjustments) {
    rows.push({
      id: `led-a-${a._id}`,
      date: a.date,
      type: "adjustment",
      description: "Stock reconciliation",
      reference: `ADJ-${String(a._id).replace("adj-", "")}`,
      stockIn: a.adjustmentType === "increase" ? a.quantity : 0,
      stockOut: a.adjustmentType === "decrease" ? a.quantity : 0,
      sort: `${a.date}|a|${a._id}`,
    });
  }
  for (const t of transfers) {
    if (t.destinationWarehouseId === warehouseId) {
      rows.push({
        id: `led-t-${t._id}`,
        date: t.date,
        type: "transfer-in",
        description: "Transfer received",
        reference: `TRF-${String(t._id).replace("trf-", "")}`,
        stockIn: t.quantity,
        stockOut: 0,
        sort: `${t.date}|t|${t._id}`,
      });
    }
    if (t.sourceWarehouseId === warehouseId) {
      rows.push({
        id: `led-t-${t._id}-out`,
        date: t.date,
        type: "transfer-out",
        description: "Transfer sent",
        reference: `TRF-${String(t._id).replace("trf-", "")}`,
        stockIn: 0,
        stockOut: t.quantity,
        sort: `${t.date}|t|${t._id}`,
      });
    }
  }

  rows.sort((a, b) => a.sort.localeCompare(b.sort));
  const entries = [];
  let balance = 0;
  for (const row of rows) {
    balance += row.stockIn - row.stockOut;
    entries.push({
      id: row.id,
      date: row.date,
      type: row.type,
      description: row.description,
      reference: row.reference,
      warehouse: item.warehouseName,
      stockIn: row.stockIn,
      stockOut: row.stockOut,
      balance,
    });
  }
  res.status(200).json(entries);
}
