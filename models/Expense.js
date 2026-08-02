import mongoose from "mongoose";

const STATUSES = ["paid", "pending", "cancelled"];
const PAYMENT_METHODS = ["cash", "bank", "cheque", "online"];

const expenseSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Expense id is required."] },
    expenseNumber: {
      type: String,
      required: [true, "Expense number is required."],
      trim: true,
      unique: true,
    },
    expenseDate: {
      type: String,
      required: [true, "Expense date is required."],
    },
    category: {
      type: String,
      required: [true, "Expense category is required."],
      trim: true,
    },
    title: {
      type: String,
      required: [true, "Expense title is required."],
      trim: true,
    },
    description: { type: String, default: "", trim: true },
    amount: {
      type: Number,
      required: [true, "Expense amount is required."],
      min: [0.01, "Expense amount must be greater than zero."],
    },
    paymentMethod: {
      type: String,
      enum: {
        values: PAYMENT_METHODS,
        message: "Payment method must be 'cash', 'bank', 'cheque' or 'online'.",
      },
      default: "cash",
    },
    paidTo: { type: String, default: "", trim: true },
    referenceNumber: { type: String, default: "", trim: true },
    attachment: { type: String, default: "" },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: "Status must be 'paid', 'pending' or 'cancelled'.",
      },
      default: "pending",
    },
    createdBy: { type: String, default: "", trim: true },
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

export default mongoose.model("Expense", expenseSchema);
