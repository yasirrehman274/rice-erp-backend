import mongoose from "mongoose";

const STATUSES = ["pending", "received", "partial", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "partial", "paid"];
const PAYMENT_METHODS = ["cash", "bank", "cheque", "online"];

const paymentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    purchaseId: { type: String, required: true },
    date: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, required: true },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    createdAt: { type: String, default: "" },
    updatedAt: { type: String, default: "" },
  },
  { _id: false },
);

const itemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    productId: { type: String, required: true },
    productName: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 1 },
    bagWeight: { type: Number, default: 0, min: 0 },
    totalWeight: { type: Number, default: 0, min: 0 },
    currentPurchasePrice: { type: Number, default: 0, min: 0 },
    purchaseRate: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0, min: 0 },
    batchNumber: { type: String, default: "" },
    riceVariety: { type: String, default: "" },
  },
  { _id: false },
);

const purchaseSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Purchase id is required."] },
    purchaseNumber: {
      type: String,
      required: [true, "Purchase number is required."],
      trim: true,
      unique: true,
    },
    purchaseDate: {
      type: String,
      required: [true, "Purchase date is required."],
    },
    supplierId: { type: String, default: "" },
    supplierName: { type: String, default: "", trim: true },
    warehouseId: { type: String, default: "" },
    warehouseName: { type: String, default: "", trim: true },
    productId: { type: String, default: "" },
    productName: { type: String, default: "", trim: true },
    batchNumber: { type: String, default: "" },
    riceVariety: { type: String, default: "" },
    quantity: { type: Number, default: 0, min: 0 },
    bagWeight: { type: Number, default: 0, min: 0 },
    totalWeight: { type: Number, default: 0, min: 0 },
    currentPurchasePrice: { type: Number, default: 0, min: 0 },
    purchaseRate: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    transportCharges: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    payments: { type: [paymentSchema], default: [] },
    items: { type: [itemSchema], default: [] },
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
        message: "Status must be 'pending', 'received', 'partial' or 'cancelled'.",
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
    receivedDate: { type: String, default: "" },
    receivedBy: { type: String, default: "" },
  },
  { versionKey: false, toJSON: { virtuals: true } },
);

export default mongoose.model("Purchase", purchaseSchema);
