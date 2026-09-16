import mongoose from "mongoose";

const STATUSES = ["active", "inactive"];
const COMMISSION_TYPES = ["", "fixed", "percentage"];

function validatePakistaniPhone(value) {
  return /^03\d{9}$/.test(String(value).replaceAll("-", ""));
}

const brokerSchema = new mongoose.Schema(
  {
    _id: { type: String, required: [true, "Broker id is required."] },
    brokerNumber: { type: String, unique: true, trim: true },
    name: {
      type: String,
      required: [true, "Broker name is required."],
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
      validate: {
        validator: (value) => !value || validatePakistaniPhone(value),
        message: "Enter a valid Pakistani mobile number.",
      },
    },
    alternatePhone: {
      type: String,
      default: "",
      trim: true,
      validate: {
        validator: (value) => !value || validatePakistaniPhone(value),
        message: "Enter a valid Pakistani mobile number.",
      },
    },
    city: { type: String, default: "", trim: true },
    address: { type: String, default: "" },
    commissionType: {
      type: String,
      enum: {
        values: COMMISSION_TYPES,
        message: "Commission type must be 'fixed' or 'percentage'.",
      },
      default: "",
    },
    commissionRate: { type: Number, default: 0, min: [0, "Commission rate cannot be negative."] },
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
  },
  { versionKey: false, toJSON: { virtuals: true } },
);

export default mongoose.model("Broker", brokerSchema);