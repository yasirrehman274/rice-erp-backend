import mongoose from "mongoose";

const STATUSES = ["active", "inactive"];

function validatePakistaniPhone(value) {
  return /^03\d{9}$/.test(String(value).replaceAll("-", ""));
}

function validateEmail(value) {
  return !value || /^\S+@\S+\.\S+$/.test(value);
}

function validateCnic(value) {
  return !value || /^\d{5}-\d{7}-\d{1}$/.test(value);
}

const customerSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Customer id is required."] },
    name: {
      type: String,
      required: [true, "Customer name is required."],
      trim: true,
    },
    businessName: { type: String, default: "", trim: true },
    phone: {
      type: String,
      required: [true, "Phone number is required."],
      trim: true,
      unique: true,
      validate: {
        validator: validatePakistaniPhone,
        message: "Enter a valid Pakistani mobile number.",
      },
    },
    whatsapp: {
      type: String,
      default: "",
      trim: true,
      validate: {
        validator: (value) => !value || validatePakistaniPhone(value),
        message: "Enter a valid Pakistani mobile number.",
      },
    },
    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      validate: {
        validator: validateEmail,
        message: "Enter a valid email address.",
      },
    },
    cnic: {
      type: String,
      default: "",
      trim: true,
      validate: {
        validator: validateCnic,
        message: "Enter a valid CNIC (e.g. 35202-1234567-1).",
      },
    },
    ntn: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    address: { type: String, default: "" },
    openingBalance: { type: Number, default: 0, min: [0, "Opening balance cannot be negative."] },
    currentBalance: { type: Number, default: 0, min: [0, "Current balance cannot be negative."] },
    creditLimit: { type: Number, default: 0, min: [0, "Credit limit cannot be negative."] },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: "Status must be 'active' or 'inactive'.",
      },
      default: "active",
    },
    notes: { type: String, default: "" },
    createdAt: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
    totalOrders: { type: Number, default: 0, min: 0 },
    totalPayments: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false, toJSON: { virtuals: true } },
);

export default mongoose.model("Customer", customerSchema);
