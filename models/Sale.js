import mongoose from "mongoose";

const STATUSES = ["pending", "dispatched", "partial", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "partial", "paid"];
const PAYMENT_METHODS = ["cash", "bank", "cheque", "online"];

const saleSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Sale id is required."] },
    saleNumber: {
      type: String,
      required: [true, "Sale number is required."],
      trim: true,
      unique: true,
    },
    saleDate: {
      type: String,
      required: [true, "Sale date is required."],
    },
    customerId: { type: String, default: "" },
    customerName: { type: String, default: "", trim: true },
    warehouseId: { type: String, default: "" },
    warehouseName: { type: String, default: "", trim: true },
    productId: { type: String, default: "" },
    productName: { type: String, default: "", trim: true },
    batchNumber: { type: String, default: "" },
    riceVariety: { type: String, default: "" },
    quantity: { type: Number, default: 0, min: 0 },
    bagWeight: { type: Number, default: 0, min: 0 },
    totalWeight: { type: Number, default: 0, min: 0 },
    currentSalePrice: { type: Number, default: 0, min: 0 },
    saleRate: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    transportCharges: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
    receivedAmount: { type: Number, default: 0, min: 0 },
    remainingBalance: { type: Number, default: 0, min: 0 },
    paymentMethod: {
      type: String,
      enum: {
        values: PAYMENT_METHODS,
        message: "Payment method must be 'cash', 'bank', 'cheque' or 'online'.",
      },
      default: "cash",
    },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: "Status must be 'pending', 'dispatched', 'partial' or 'cancelled'.",
      },
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: {
        values: PAYMENT_STATUSES,
        message: "Payment status must be 'unpaid', 'partial' or 'paid'.",
      },
      default: "unpaid",
    },
    notes: { type: String, default: "" },
    createdAt: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
    updatedAt: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
    dispatchedDate: { type: String, default: "" },
    dispatchedBy: { type: String, default: "" },
  },
  { versionKey: false, toJSON: { virtuals: true } },
);

export default mongoose.model("Sale", saleSchema);
