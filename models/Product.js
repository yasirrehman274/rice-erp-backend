import mongoose from "mongoose";

const STATUSES = ["active", "inactive"];
const UNITS = ["Bag", "Kg", "Ton"];

const productSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Product id is required."] },
    productName: {
      type: String,
      required: [true, "Product name is required."],
      trim: true,
    },
    riceCode: {
      type: String,
      required: [true, "Rice code is required."],
      trim: true,
      uppercase: true,
      unique: true,
    },
    category: {
      type: String,
      required: [true, "Category is required."],
      trim: true,
    },
    brand: { type: String, default: "", trim: true },
    variety: { type: String, default: "", trim: true },
    unit: {
      type: String,
      enum: {
        values: UNITS,
        message: "Unit must be 'Bag', 'Kg' or 'Ton'.",
      },
      default: "Bag",
    },
    bagWeight: { type: String, default: "" },
    lastPurchasePrice: { type: Number, default: 0, min: 0 },
    suggestedSalePrice: { type: Number, default: 0, min: 0 },
    minimumStock: { type: Number, default: 0, min: 0 },
    currentStock: { type: Number, default: 0, min: 0 },
    warehouseCount: { type: Number, default: 0, min: 0 },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: "Status must be 'active' or 'inactive'.",
      },
      default: "active",
    },
    createdDate: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
  },
  { versionKey: false, toJSON: { virtuals: true } },
);

export default mongoose.model("Product", productSchema);
