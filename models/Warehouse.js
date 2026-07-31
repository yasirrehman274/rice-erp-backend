import mongoose from "mongoose";

const STATUSES = ["active", "inactive"];

function validatePakistaniPhone(value) {
  return /^03\d{9}$/.test(String(value).replaceAll("-", ""));
}

function validateEmail(value) {
  return !value || /^\S+@\S+\.\S+$/.test(value);
}

const warehouseSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Warehouse id is required."] },
    name: {
      type: String,
      required: [true, "Warehouse name is required."],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Warehouse code is required."],
      trim: true,
      uppercase: true,
      unique: true,
    },
    manager: { type: String, default: "", trim: true },
    phone: {
      type: String,
      required: [true, "Phone number is required."],
      trim: true,
      validate: {
        validator: validatePakistaniPhone,
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
    city: { type: String, default: "", trim: true },
    address: { type: String, default: "" },
    capacity: {
      type: Number,
      required: [true, "Capacity is required."],
      min: [1, "Capacity must be greater than zero."],
    },
    occupiedCapacity: { type: Number, default: 0, min: 0 },
    productCount: { type: Number, default: 0, min: 0 },
    totalStock: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: "Status must be 'active' or 'inactive'.",
      },
      default: "active",
    },
    notes: { type: String, default: "" },
    createdDate: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
  },
  { versionKey: false, toJSON: { virtuals: true } },
);

export default mongoose.model("Warehouse", warehouseSchema);
