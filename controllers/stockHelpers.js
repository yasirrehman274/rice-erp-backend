import InventoryItem from "../models/InventoryItem.js";
import Product from "../models/Product.js";
import Warehouse from "../models/Warehouse.js";

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function nextInventoryId() {
  const docs = await InventoryItem.find({}, { _id: 1 }).lean();
  let max = 0;
  for (const doc of docs) {
    const n = parseInt(String(doc._id).split("-")[1], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `inv-${String(max + 1).padStart(3, "0")}`;
}

export async function incrementInventory({ productId, warehouseId, quantity, avgCostRate, meta = {}, date }) {
  let item = await InventoryItem.findOne({ productId, warehouseId });
  if (!item) {
    const product = await Product.findById(productId).lean();
    const warehouse = await Warehouse.findById(warehouseId).lean();
    item = await InventoryItem.create({
      _id: await nextInventoryId(),
      productId,
      warehouseId,
      productName: product?.productName ?? meta.productName ?? "",
      riceCode: product?.riceCode ?? meta.riceCode ?? "",
      category: product?.category ?? meta.category ?? "",
      warehouseName: warehouse?.name ?? meta.warehouseName ?? "",
      currentStock: quantity,
      reservedStock: 0,
      minimumStock: product?.minimumStock ?? meta.minimumStock ?? 0,
      unit: product?.unit ?? meta.unit ?? "Bag",
      averageCostPerKG: avgCostRate > 0 ? avgCostRate : 0,
      updatedAt: date ?? today(),
    });
    return item;
  }

  const oldCost = item.averageCostPerKG * item.currentStock;
  const newCost = avgCostRate > 0 ? avgCostRate * quantity : 0;
  const newStock = item.currentStock + quantity;
  const avgCost = avgCostRate > 0 && newStock > 0 ? (oldCost + newCost) / newStock : item.averageCostPerKG;
  return InventoryItem.findOneAndUpdate(
    { productId, warehouseId },
    {
      $set: {
        averageCostPerKG: avgCost,
        updatedAt: date ?? today(),
        ...(meta.productName ? { productName: meta.productName } : {}),
      },
      $inc: { currentStock: quantity },
    },
    { new: true, runValidators: true },
  );
}

export async function decrementInventory({ productId, warehouseId, quantity }) {
  const item = await InventoryItem.findOne({ productId, warehouseId });
  if (!item) return null;
  const newStock = Math.max(0, item.currentStock - quantity);
  const reservedStock = Math.min(item.reservedStock, newStock);
  return InventoryItem.findOneAndUpdate(
    { productId, warehouseId },
    { $set: { currentStock: newStock, reservedStock, updatedAt: today() } },
    { new: true },
  );
}

export async function syncProductStock(productId) {
  const items = await InventoryItem.find({ productId }).lean();
  const currentStock = items.reduce((sum, i) => sum + i.currentStock, 0);
  const warehouseCount = items.filter((i) => i.currentStock > 0).length;
  await Product.updateOne({ _id: productId }, { $set: { currentStock, warehouseCount } });
}

export async function syncWarehouseStats(warehouseId) {
  const items = await InventoryItem.find({ warehouseId }).lean();
  const totalStock = items.reduce((sum, i) => sum + i.currentStock, 0);
  const productCount = items.filter((i) => i.currentStock > 0).length;
  await Warehouse.updateOne({ _id: warehouseId }, { $set: { totalStock, productCount, occupiedCapacity: totalStock } });
}
