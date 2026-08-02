import Customer from "../models/Customer.js";
import Sale from "../models/Sale.js";

function sanitizeBody(body = {}) {
  const { id, _id, currentBalance, totalOrders, totalPayments, ...rest } = body;
  return rest;
}

function sanitizeCreateBody(body = {}) {
  const { id, _id, ...rest } = body;
  if (!("currentBalance" in body) && Number(body.openingBalance) > 0) {
    rest.currentBalance = Number(body.openingBalance);
  }
  return rest;
}

export async function getAllCustomers(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ name: regex }, { businessName: regex }, { phone: regex }, { city: regex }, { email: regex }];
  }
  const customers = await Customer.find(query).sort({ createdAt: -1, name: 1 });
  res.status(200).json(customers);
}

export async function getCustomerById(req, res) {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }
  res.status(200).json(customer);
}

export async function createCustomer(req, res) {
  const { id } = req.body;
  const customer = await Customer.create({ _id: id, ...sanitizeCreateBody(req.body) });
  res.status(201).json(customer);
}

export async function updateCustomer(req, res) {
  const customer = await Customer.findByIdAndUpdate(
    req.params.id,
    sanitizeBody(req.body),
    { new: true, runValidators: true },
  );
  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }
  res.status(200).json(customer);
}

export async function deleteCustomer(req, res) {
  const customer = await Customer.findByIdAndDelete(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }
  res.status(200).json({ message: "Customer deleted." });
}

export async function getCustomerOrders(req, res) {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }
  const sales = await Sale.find({ customerId: customer._id })
    .sort({ saleDate: -1 })
    .limit(10)
    .lean();
  res.status(200).json(
    sales.map((s) => ({
      id: s._id,
      date: s.saleDate,
      product: s.productName,
      quantity: `${s.quantity} bags`,
      amount: s.grandTotal,
      status: s.paymentStatus === "paid" ? "Paid" : s.paymentStatus === "partial" ? "Partial" : "Pending",
    })),
  );
}

export async function getCustomerLedger(req, res) {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }
  const sales = await Sale.find({ customerId: customer._id })
    .sort({ saleDate: 1 })
    .lean();
  const entries = [];
  let balance = customer.openingBalance;
  entries.push({
    id: "open",
    date: customer.createdAt,
    description: "Opening balance",
    reference: "OPEN",
    debit: customer.openingBalance,
    credit: 0,
    balance,
  });
  let seq = 1;
  for (const s of sales) {
    if (s.grandTotal > 0) {
      balance += s.grandTotal;
      entries.push({
        id: String(seq++),
        date: s.saleDate,
        description: `Sale - ${s.productName}`,
        reference: s.saleNumber,
        debit: s.grandTotal,
        credit: 0,
        balance,
      });
    }
    if (s.receivedAmount > 0) {
      balance -= s.receivedAmount;
      entries.push({
        id: String(seq++),
        date: s.updatedAt,
        description: `Payment received (${s.paymentMethod})`,
        reference: `PAY-${s.saleNumber.slice(-4)}`,
        debit: 0,
        credit: s.receivedAmount,
        balance,
      });
    }
  }
  res.status(200).json(entries);
}
