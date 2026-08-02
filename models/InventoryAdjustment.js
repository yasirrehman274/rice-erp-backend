import mongoose from "mongoose";

const TYPES = ["increase", "decrease"];

const inventoryAdjustmentSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Adjustment id is required."] },
    inventoryItemId: { type: String, required: [true, "Inventory item is required."] },
    productId: { type: String, required: true },
    productName: { type: String, required: true, trim: true },
    warehouseId: { type: String, required: true },
    warehouseName: { type: String, required: true, trim: true },
    adjustmentType: {
      type: String,
      enum: {
        values: TYPES,
        message: "Adjustment type must be 'increase' or 'decrease'.",
      },
      required: [true, "Adjustment type is required."],
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required."],
      min: [1, "Quantity must be greater than zero."],
    },
    reason: { type: String, default: "", trim: true },
    notes: { type: String, default: "" },
    date: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
  },
  { versionKey: false },
);

export default mongoose.model("InventoryAdjustment", inventoryAdjustmentSchema);
