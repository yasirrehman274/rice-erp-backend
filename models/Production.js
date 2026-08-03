import mongoose from "mongoose";

const STATUSES = ["completed", "cancelled"];

const productionMaterialSchema = new mongoose.Schema(
  {
    productId: { type: String, required: [true, "Material product is required."] },
    productName: { type: String, required: [true, "Material product name is required."], trim: true },
    riceCode: { type: String, default: "", trim: true },
    warehouseId: { type: String, default: "" },
    availableStock: { type: Number, default: 0, min: 0 },
    bagWeight: { type: Number, default: 0, min: 0 },
    costPerBag: { type: Number, default: 0, min: 0 },
    quantityUsed: { type: Number, required: [true, "Quantity used is required."], min: 1 },
    totalWeight: { type: Number, default: 0, min: 0 },
    totalCost: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const productionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Production id is required."] },
    productionNumber: {
      type: String,
      required: [true, "Production number is required."],
      trim: true,
      unique: true,
    },
    productionDate: {
      type: String,
      required: [true, "Production date is required."],
    },
    warehouseId: { type: String, required: [true, "Warehouse is required."] },
    warehouseName: { type: String, required: [true, "Warehouse name is required."], trim: true },
    outputProductId: { type: String, required: [true, "Output product is required."] },
    outputProductName: { type: String, required: [true, "Output product name is required."], trim: true },
    outputBagWeight: { type: Number, default: 0, min: 0 },
    outputBags: { type: Number, default: 0, min: 0 },
    outputCostPerBag: { type: Number, default: 0, min: 0 },
    totalInputWeight: { type: Number, default: 0, min: 0 },
    totalInputCost: { type: Number, default: 0, min: 0 },
    operator: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: "Status must be 'completed' or 'cancelled'.",
      },
      default: "completed",
    },
    materials: { type: [productionMaterialSchema], default: [] },
    createdAt: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
    updatedAt: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
  },
  { versionKey: false, toJSON: { virtuals: true } },
);

export default mongoose.model("Production", productionSchema);
