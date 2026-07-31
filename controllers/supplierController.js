import Supplier from "../models/Supplier.js";

function sanitizeBody(body = {}) {
  const { id, _id, ...rest } = body;
  return rest;
}

export async function getAllSuppliers(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ name: regex }, { contactPerson: regex }, { phone: regex }, { city: regex }, { email: regex }];
  }
  const suppliers = await Supplier.find(query).sort({ createdAt: -1, name: 1 });
  res.status(200).json(suppliers);
}

export async function getSupplierById(req, res) {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: "Supplier not found." });
  }
  res.status(200).json(supplier);
}

export async function createSupplier(req, res) {
  const { id } = req.body;
  const supplier = await Supplier.create({ _id: id, ...sanitizeBody(req.body) });
  res.status(201).json(supplier);
}

export async function updateSupplier(req, res) {
  const supplier = await Supplier.findByIdAndUpdate(
    req.params.id,
    sanitizeBody(req.body),
    { new: true, runValidators: true },
  );
  if (!supplier) {
    return res.status(404).json({ message: "Supplier not found." });
  }
  res.status(200).json(supplier);
}

export async function deleteSupplier(req, res) {
  const supplier = await Supplier.findByIdAndDelete(req.params.id);
  if (!supplier) {
    return res.status(404).json({ message: "Supplier not found." });
  }
  res.status(200).json({ message: "Supplier deleted." });
}
