import Production from "../models/Production.js";
import Product from "../models/Product.js";
import Warehouse from "../models/Warehouse.js";
import InventoryItem from "../models/InventoryItem.js";
import {
  today,
  incrementInventory,
  decrementInventory,
  syncProductStock,
  syncWarehouseStats,
} from "./stockHelpers.js";

function sanitizeBody(body = {}) {
  const { id, _id, warehouseName, outputProductName, outputBagWeight, outputBags, outputCostPerBag, totalInputWeight, totalInputCost, ...rest } = body;
  return rest;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function parseBagWeight(value) {
  if (typeof value === "number") return value > 0 ? value : 0;
  const match = String(value ?? "").match(/\d+(\.\d+)?/);
  const parsed = match ? parseFloat(match[0]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function nextProductionNumber() {
  const docs = await Production.find({}, { productionNumber: 1 }).lean();
  let max = 1000;
  for (const doc of docs) {
    const n = parseInt(String(doc.productionNumber).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `PRD-${max + 1}`;
}

async function resolveNames(body) {
  const [warehouse, outputProduct] = await Promise.all([
    body.warehouseId ? Warehouse.findById(body.warehouseId).lean() : null,
    body.outputProductId ? Product.findById(body.outputProductId).lean() : null,
  ]);
  return {
    warehouseName: warehouse?.name ?? "",
    outputProductName: outputProduct?.productName ?? "",
    outputBagWeight: parseBagWeight(outputProduct?.bagWeight),
  };
}

async function buildProduction(body) {
  const names = await resolveNames(body);
  const warehouseId = body.warehouseId ?? "";
  const rawMaterials = Array.isArray(body.materials) ? body.materials : [];
  const materials = [];
  for (const row of rawMaterials) {
    if (!row || !row.productId) continue;
    const product = await Product.findById(row.productId).lean();
    const item = await InventoryItem.findOne({ productId: row.productId, warehouseId }).lean();
    const bagWeight = parseBagWeight(product?.bagWeight) || (Number(row.bagWeight) > 0 ? Number(row.bagWeight) : 0);
    const quantityUsed = Math.max(0, Number(row.quantityUsed) || 0);
    const costPerBag = Math.max(0, Number(row.costPerBag) || 0);
    materials.push({
      productId: row.productId,
      productName: product?.productName ?? row.productName ?? "",
      riceCode: product?.riceCode ?? row.riceCode ?? "",
      warehouseId,
      availableStock: item ? item.currentStock - item.reservedStock : 0,
      bagWeight,
      costPerBag,
      quantityUsed,
      totalWeight: round2(quantityUsed * bagWeight),
      totalCost: round2(quantityUsed * costPerBag),
    });
  }
  const totalInputWeight = round2(materials.reduce((sum, m) => sum + m.totalWeight, 0));
  const totalInputCost = round2(materials.reduce((sum, m) => sum + m.totalCost, 0));
  const outputBags = names.outputBagWeight > 0 ? round2(totalInputWeight / names.outputBagWeight) : 0;
  const outputCostPerBag = outputBags > 0 ? round2(totalInputCost / outputBags) : 0;
  return {
    productionNumber: body.productionNumber,
    productionDate: body.productionDate || today(),
    warehouseId,
    warehouseName: names.warehouseName,
    outputProductId: body.outputProductId ?? "",
    outputProductName: names.outputProductName,
    outputBagWeight: names.outputBagWeight,
    outputBags,
    outputCostPerBag,
    totalInputWeight,
    totalInputCost,
    operator: body.operator ?? "",
    notes: body.notes ?? "",
    status: body.status ?? "completed",
    materials,
  };
}

function assertValidProduction(doc) {
  const errors = [];
  if (!doc.warehouseId) errors.push("Warehouse is required.");
  if (!doc.outputProductId) errors.push("Output product is required.");
  if (doc.materials.length === 0) errors.push("At least one input material is required.");
  const seen = new Set();
  for (const material of doc.materials) {
    const name = material.productName || material.productId;
    if (seen.has(material.productId)) errors.push(`Duplicate material: ${name}.`);
    seen.add(material.productId);
    if (material.productId === doc.outputProductId) errors.push(`Output product cannot also be used as an input material (${name}).`);
    if (material.quantityUsed <= 0) errors.push(`Quantity used must be greater than zero for ${name}.`);
    if (material.availableStock < material.quantityUsed) {
      errors.push(`Insufficient stock available. Requested: ${material.quantityUsed}, Available: ${material.availableStock} (${name})`);
    }
  }
  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.status = 400;
    throw error;
  }
}

async function applyProduction(doc) {
  const touchedProducts = new Set();
  const touchedWarehouses = new Set();
  const applied = [];
  for (const material of doc.materials) {
    await decrementInventory({
      productId: material.productId,
      warehouseId: material.warehouseId,
      quantity: material.quantityUsed,
    });
    applied.push({ kind: "input", productId: material.productId, warehouseId: material.warehouseId, quantity: material.quantityUsed });
    touchedProducts.add(material.productId);
    touchedWarehouses.add(material.warehouseId);
  }
  if (doc.outputBags > 0) {
    const product = await Product.findById(doc.outputProductId).lean();
    await incrementInventory({
      productId: doc.outputProductId,
      warehouseId: doc.warehouseId,
      quantity: doc.outputBags,
      avgCostRate: doc.outputCostPerBag > 0 ? doc.outputCostPerBag : 0,
      meta: {
        productName: doc.outputProductName,
        riceCode: product?.riceCode ?? "",
        category: product?.category ?? "",
        warehouseName: doc.warehouseName,
        unit: product?.unit ?? "Bag",
        minimumStock: product?.minimumStock ?? 0,
      },
      date: doc.productionDate,
    });
    applied.push({ kind: "output", productId: doc.outputProductId, warehouseId: doc.warehouseId, quantity: doc.outputBags });
    touchedProducts.add(doc.outputProductId);
    touchedWarehouses.add(doc.warehouseId);
  }
  for (const productId of touchedProducts) await syncProductStock(productId);
  for (const warehouseId of touchedWarehouses) await syncWarehouseStats(warehouseId);
  return applied;
}

async function compensate(applied) {
  const touchedProducts = new Set();
  const touchedWarehouses = new Set();
  for (const step of applied.reverse()) {
    if (step.kind === "input") {
      await incrementInventory({
        productId: step.productId,
        warehouseId: step.warehouseId,
        quantity: step.quantity,
        avgCostRate: 0,
        date: today(),
      });
    } else {
      await decrementInventory({
        productId: step.productId,
        warehouseId: step.warehouseId,
        quantity: step.quantity,
      });
    }
    touchedProducts.add(step.productId);
    touchedWarehouses.add(step.warehouseId);
  }
  for (const productId of touchedProducts) await syncProductStock(productId);
  for (const warehouseId of touchedWarehouses) await syncWarehouseStats(warehouseId);
}

async function reverseProduction(doc) {
  const touchedProducts = new Set();
  const touchedWarehouses = new Set();
  for (const material of doc.materials) {
    await incrementInventory({
      productId: material.productId,
      warehouseId: material.warehouseId,
      quantity: material.quantityUsed,
      avgCostRate: 0,
      date: doc.productionDate,
    });
    touchedProducts.add(material.productId);
    touchedWarehouses.add(material.warehouseId);
  }
  if (doc.outputBags > 0) {
    await decrementInventory({
      productId: doc.outputProductId,
      warehouseId: doc.warehouseId,
      quantity: doc.outputBags,
    });
    touchedProducts.add(doc.outputProductId);
    touchedWarehouses.add(doc.warehouseId);
  }
  for (const productId of touchedProducts) await syncProductStock(productId);
  for (const warehouseId of touchedWarehouses) await syncWarehouseStats(warehouseId);
}

export async function getAllProductions(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [
      { productionNumber: regex },
      { outputProductName: regex },
      { warehouseName: regex },
      { operator: regex },
    ];
  }
  const productions = await Production.find(query).sort({ productionDate: -1, createdAt: -1 });
  res.status(200).json(productions);
}

export async function getProductionById(req, res) {
  const production = await Production.findById(req.params.id);
  if (!production) {
    return res.status(404).json({ message: "Production not found." });
  }
  res.status(200).json(production);
}

export async function createProduction(req, res) {
  const { id } = req.body;
  const body = sanitizeBody(req.body);
  const doc = await buildProduction(body);
  assertValidProduction(doc);
  if (!doc.productionNumber) doc.productionNumber = await nextProductionNumber();
  let applied = [];
  try {
    applied = await applyProduction(doc);
    const production = await Production.create({ _id: id ?? `mfg-${Date.now()}`, ...doc });
    res.status(201).json(production);
  } catch (error) {
    if (applied.length > 0) {
      await compensate(applied).catch(() => {});
    }
    throw error;
  }
}

export async function importProduction(req, res) {
  const { id, _id, ...rest } = req.body;
  const production = await Production.create({ _id: id ?? _id, ...rest });
  res.status(201).json(production);
}

export async function updateProduction(req, res) {
  const old = await Production.findById(req.params.id);
  if (!old) {
    return res.status(404).json({ message: "Production not found." });
  }
  const body = sanitizeBody(req.body);
  const doc = await buildProduction(body);
  assertValidProduction(doc);
  if (!doc.productionNumber) doc.productionNumber = old.productionNumber;
  let applied = [];
  try {
    await reverseProduction(old);
    applied = await applyProduction(doc);
    const production = await Production.findByIdAndUpdate(
      req.params.id,
      { ...doc, updatedAt: today() },
      { new: true, runValidators: true },
    );
    res.status(200).json(production);
  } catch (error) {
    if (applied.length > 0) {
      await compensate(applied).catch(() => {});
    }
    throw error;
  }
}

export async function deleteProduction(req, res) {
  const production = await Production.findById(req.params.id);
  if (!production) {
    return res.status(404).json({ message: "Production not found." });
  }
  await reverseProduction(production);
  await Production.findByIdAndDelete(production._id);
  res.status(200).json({ message: "Production deleted." });
}

export async function getProductionStats(req, res) {
  const productions = await Production.find({}).lean();
  const active = productions.filter((p) => p.status !== "cancelled");
  const todayKey = today();
  const monthKey = todayKey.slice(0, 7);
  const todayList = active.filter((p) => p.productionDate === todayKey);
  const monthList = active.filter((p) => p.productionDate && p.productionDate.startsWith(monthKey));
  const sumBags = (list) => round2(list.reduce((sum, p) => sum + (p.outputBags || 0), 0));
  const sumCost = (list) => round2(list.reduce((sum, p) => sum + (p.totalInputCost || 0), 0));
  res.status(200).json({
    totalProductions: active.length,
    totalOutputBags: sumBags(active),
    totalProductionCost: sumCost(active),
    todayProductions: todayList.length,
    todayOutputBags: sumBags(todayList),
    todayProductionCost: sumCost(todayList),
    monthProductions: monthList.length,
    monthOutputBags: sumBags(monthList),
    monthProductionCost: sumCost(monthList),
  });
}

export async function getProductionHistory(req, res) {
  const productions = await Production.find({}).sort({ productionDate: -1, createdAt: -1 }).lean();
  res.status(200).json(
    productions.map((p) => ({
      id: p._id,
      productionId: p._id,
      productionNumber: p.productionNumber,
      date: p.productionDate,
      outputProductName: p.outputProductName,
      outputBags: p.outputBags,
      totalInputCost: p.totalInputCost,
      status: p.status,
    })),
  );
}
