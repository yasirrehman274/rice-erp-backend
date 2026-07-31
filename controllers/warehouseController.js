import Warehouse from "../models/Warehouse.js";

function sanitizeBody(body = {}) {
  const { id, _id, ...rest } = body;
  return rest;
}

export async function getAllWarehouses(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ name: regex }, { code: regex }, { manager: regex }, { city: regex }];
  }
  const warehouses = await Warehouse.find(query).sort({ createdDate: -1, name: 1 });
  res.status(200).json(warehouses);
}

export async function getWarehouseById(req, res) {
  const warehouse = await Warehouse.findById(req.params.id);
  if (!warehouse) {
    return res.status(404).json({ message: "Warehouse not found." });
  }
  res.status(200).json(warehouse);
}

export async function createWarehouse(req, res) {
  const { id } = req.body;
  const warehouse = await Warehouse.create({ _id: id, ...sanitizeBody(req.body) });
  res.status(201).json(warehouse);
}

export async function updateWarehouse(req, res) {
  const warehouse = await Warehouse.findByIdAndUpdate(
    req.params.id,
    sanitizeBody(req.body),
    { new: true, runValidators: true },
  );
  if (!warehouse) {
    return res.status(404).json({ message: "Warehouse not found." });
  }
  res.status(200).json(warehouse);
}

export async function deleteWarehouse(req, res) {
  const warehouse = await Warehouse.findByIdAndDelete(req.params.id);
  if (!warehouse) {
    return res.status(404).json({ message: "Warehouse not found." });
  }
  res.status(200).json({ message: "Warehouse deleted." });
}
