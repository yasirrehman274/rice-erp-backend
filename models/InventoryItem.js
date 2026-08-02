import mongoose from "mongoose";

const inventoryItemSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Inventory item id is required."] },
    productId: { type: String, required: [true, "Product is required."] },
    productName: { type: String, required: [true, "Product name is required."], trim: true },
    riceCode: { type: String, default: "", trim: true },
    category: { type: String, default: "", trim: true },
    warehouseId: { type: String, required: [true, "Warehouse is required."] },
    warehouseName: { type: String, required: [true, "Warehouse name is required."], trim: true },
    currentStock: { type: Number, default: 0, min: 0 },
    reservedStock: { type: Number, default: 0, min: 0 },
    minimumStock: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: "Bag" },
    averageCostPerKG: { type: Number, default: 0, min: 0 },
    updatedAt: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
  },
  {
    versionKey: false,
    toJSON: { virtuals: true },
  },
);

inventoryItemSchema.index({ productId: 1, warehouseId: 1 }, { unique: true });

inventoryItemSchema.virtual("availableStock").get(function () {
  return this.currentStock - this.reservedStock;
});

export default mongoose.model("InventoryItem", inventoryItemSchema);
