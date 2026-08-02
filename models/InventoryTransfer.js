import mongoose from "mongoose";

const inventoryTransferSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Transfer id is required."] },
    productId: { type: String, required: true },
    productName: { type: String, required: true, trim: true },
    sourceWarehouseId: { type: String, required: true },
    sourceWarehouseName: { type: String, required: true, trim: true },
    destinationWarehouseId: { type: String, required: true },
    destinationWarehouseName: { type: String, required: true, trim: true },
    quantity: {
      type: Number,
      required: [true, "Quantity is required."],
      min: [1, "Quantity must be greater than zero."],
    },
    notes: { type: String, default: "" },
    date: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
  },
  { versionKey: false },
);

export default mongoose.model("InventoryTransfer", inventoryTransferSchema);
