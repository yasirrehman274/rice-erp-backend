import Broker from "../models/Broker.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import { resolveDateRange, inRange, isActivePurchase, isActiveSale } from "../services/reportServices.js";

const NOT_ASSIGNED = "__none__";

function sanitizeBody(body = {}) {
  const { id, _id, brokerNumber, createdAt, updatedAt, ...rest } = body;
  return rest;
}

function sanitizeQuery(body = {}) {
  const { id, _id, brokerNumber, createdAt, updatedAt, ...rest } = body;
  if ("name" in body) rest.name = String(body.name).trim();
  if ("status" in body) rest.status = body.status === "inactive" ? "inactive" : "active";
  return rest;
}

export async function getAllBrokers(req, res) {
  const { search, status } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ name: regex }, { phone: regex }, { alternatePhone: regex }, { city: regex }];
  }
  if (status === "active" || status === "inactive") {
    query.status = status;
  }
  const brokers = await Broker.find(query).sort({ createdAt: -1, name: 1 });
  res.status(200).json(brokers);
}

export async function getBrokerById(req, res) {
  const broker = await Broker.findById(req.params.id);
  if (!broker) {
    return res.status(404).json({ message: "Broker not found." });
  }
  res.status(200).json(broker);
}

export async function createBroker(req, res) {
  const { id } = req.body;
  const body = sanitizeBody(req.body);
  const name = String(body.name ?? "").trim();
  if (!name) {
    return res.status(400).json({ message: "Broker name is required." });
  }
  const existing = await Broker.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  if (existing) {
    return res.status(409).json({ message: "A broker with this name already exists." });
  }
  const broker = await Broker.create({ _id: id, brokerNumber: id, ...body });
  res.status(201).json(broker);
}

export async function updateBroker(req, res) {
  const body = sanitizeBody(req.body);
  if ("name" in body) {
    const name = String(body.name).trim();
    if (!name) {
      return res.status(400).json({ message: "Broker name is required." });
    }
    const existing = await Broker.findOne({
      _id: { $ne: req.params.id },
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
    if (existing) {
      return res.status(409).json({ message: "A broker with this name already exists." });
    }
  }
  const broker = await Broker.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!broker) {
    return res.status(404).json({ message: "Broker not found." });
  }
  res.status(200).json(broker);
}

export async function deleteBroker(req, res) {
  const broker = await Broker.findById(req.params.id);
  if (!broker) {
    return res.status(404).json({ message: "Broker not found." });
  }
  const [purchaseCount, saleCount] = await Promise.all([
    Purchase.countDocuments({ brokerId: broker._id }),
    Sale.countDocuments({ brokerId: broker._id }),
  ]);
  if (purchaseCount > 0 || saleCount > 0) {
    const deactivated = await Broker.findByIdAndUpdate(
      broker._id,
      { status: "inactive" },
      { new: true },
    );
    return res.status(200).json({
      message: `Broker is linked to ${purchaseCount} purchase(s) and ${saleCount} sale(s); it was deactivated instead of deleted.`,
      broker: deactivated,
    });
  }
  await Broker.findByIdAndDelete(broker._id);
  res.status(200).json({ message: "Broker deleted." });
}

function mapDeal(kind, doc) {
  return {
    id: doc._id,
    number: kind === "purchase" ? doc.purchaseNumber : doc.saleNumber,
    type: kind,
    date: kind === "purchase" ? doc.purchaseDate : doc.saleDate,
    counterpartName: kind === "purchase" ? doc.supplierName : doc.customerName,
    productName: doc.productName,
    quantity: doc.quantity,
    amount: doc.grandTotal,
    status: doc.status,
    paymentStatus: doc.paymentStatus,
  };
}

export async function getBrokerDeals(req, res) {
  const broker = await Broker.findById(req.params.id);
  if (!broker) {
    return res.status(404).json({ message: "Broker not found." });
  }
  const { type = "all" } = req.query;
  const [purchases, sales] = await Promise.all([
    type === "sale" ? [] : Purchase.find({ brokerId: broker._id }).sort({ purchaseDate: -1, createdAt: -1 }).lean(),
    type === "purchase" ? [] : Sale.find({ brokerId: broker._id }).sort({ saleDate: -1, createdAt: -1 }).lean(),
  ]);
  const deals = [...purchases.map((d) => mapDeal("purchase", d)), ...sales.map((d) => mapDeal("sale", d))].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)),
  );
  res.status(200).json({
    brokerId: broker._id,
    brokerName: broker.name,
    purchaseDeals: purchases.length,
    purchaseAmount: purchases.reduce((sum, d) => sum + (Number(d.grandTotal) || 0), 0),
    salesDeals: sales.length,
    salesAmount: sales.reduce((sum, d) => sum + (Number(d.grandTotal) || 0), 0),
    deals,
  });
}

export async function getBrokerReport(req, res) {
  const { brokerId, type = "all", period, start, end } = req.query;
  const range = resolveDateRange({ period, start, end });
  const brokers = await Broker.find({}).lean();
  const [purchases, sales] = await Promise.all([
    type === "sale" ? [] : Purchase.find({}).lean(),
    type === "purchase" ? [] : Sale.find({}).lean(),
  ]);
  const rows = new Map(brokers.map((b) => [String(b._id), { brokerId: String(b._id), brokerName: b.name, status: b.status, purchaseDeals: 0, purchaseAmount: 0, salesDeals: 0, salesAmount: 0 }]));
  const isAll = !brokerId || brokerId === "all";
  const onlyUnassigned = brokerId === NOT_ASSIGNED;
  const matchesBroker = (dealBrokerId) => {
    if (!dealBrokerId) return isAll || onlyUnassigned;
    if (onlyUnassigned) return false;
    return isAll || String(dealBrokerId) === String(brokerId);
  };
  const unassigned = { brokerId: NOT_ASSIGNED, brokerName: "Not assigned", status: "", purchaseDeals: 0, purchaseAmount: 0, salesDeals: 0, salesAmount: 0 };
  const countDeal = (dealBrokerId, amount) => {
    const row = dealBrokerId ? rows.get(String(dealBrokerId)) : null;
    if (row) return row;
    if (!dealBrokerId) return unassigned;
    return null;
  };
  for (const p of purchases) {
    if (!isActivePurchase(p) || !inRange(p.purchaseDate, range)) continue;
    const dealBrokerId = p.brokerId ?? "";
    if (!matchesBroker(dealBrokerId)) continue;
    const row = countDeal(dealBrokerId, p.grandTotal);
    if (!row) continue;
    row.purchaseDeals += 1;
    row.purchaseAmount += Number(p.grandTotal) || 0;
  }
  for (const s of sales) {
    if (!isActiveSale(s) || !inRange(s.saleDate, range)) continue;
    const dealBrokerId = s.brokerId ?? "";
    if (!matchesBroker(dealBrokerId)) continue;
    const row = countDeal(dealBrokerId, s.grandTotal);
    if (!row) continue;
    row.salesDeals += 1;
    row.salesAmount += Number(s.grandTotal) || 0;
  }
  const roundRow = (row) => ({
    ...row,
    purchaseAmount: Math.round(row.purchaseAmount * 100) / 100,
    salesAmount: Math.round(row.salesAmount * 100) / 100,
  });
  let result = Array.from(rows.values()).map(roundRow);
  const hasUnassigned = unassigned.purchaseDeals > 0 || unassigned.salesDeals > 0;
  if (onlyUnassigned) {
    result = hasUnassigned ? [roundRow(unassigned)] : [];
  } else if (hasUnassigned) {
    result.push(roundRow(unassigned));
  }
  res.status(200).json(result.sort((a, b) => b.purchaseAmount + b.salesAmount - (a.purchaseAmount + a.salesAmount)));
}

export { sanitizeQuery };