import Expense from "../models/Expense.js";
import { today } from "./stockHelpers.js";

function sanitizeBody(body = {}) {
  const { id, _id, createdAt, updatedAt, ...rest } = body;
  return rest;
}

function buildHistory(expense) {
  const history = [];
  if (expense?.createdAt) {
    history.push({
      id: `hist-${expense._id}-created`,
      action: "created",
      date: expense.createdAt,
      user: expense.createdBy || "System",
      description: `Expense ${expense.expenseNumber} was created.`,
    });
  }
  if (expense?.updatedAt) {
    history.push({
      id: `hist-${expense._id}-updated`,
      action: "updated",
      date: expense.updatedAt,
      user: expense.createdBy || "System",
      description: `Expense ${expense.expenseNumber} was last updated (status: ${expense.status}).`,
    });
  }
  return history;
}

export async function getAllExpenses(req, res) {
  const { search } = req.query;
  const query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [
      { expenseNumber: regex },
      { category: regex },
      { title: regex },
      { paidTo: regex },
      { referenceNumber: regex },
    ];
  }
  const expenses = await Expense.find(query).sort({ expenseDate: -1, createdAt: -1 });
  res.status(200).json(expenses);
}

export async function getExpenseById(req, res) {
  const expense = await Expense.findById(req.params.id);
  if (!expense) {
    return res.status(404).json({ message: "Expense not found." });
  }
  res.status(200).json(expense);
}

export async function createExpense(req, res) {
  const { id } = req.body;
  const body = sanitizeBody(req.body);
  const expense = await Expense.create({ _id: id, ...body });
  res.status(201).json(expense);
}

export async function importExpense(req, res) {
  const { id, _id, ...rest } = req.body;
  const expense = await Expense.create({ _id: id ?? _id, ...rest });
  res.status(201).json(expense);
}

export async function updateExpense(req, res) {
  const old = await Expense.findById(req.params.id);
  if (!old) {
    return res.status(404).json({ message: "Expense not found." });
  }
  const body = sanitizeBody(req.body);
  const expense = await Expense.findByIdAndUpdate(
    req.params.id,
    { ...body, updatedAt: today() },
    { new: true, runValidators: true },
  );
  res.status(200).json(expense);
}

export async function deleteExpense(req, res) {
  const expense = await Expense.findById(req.params.id);
  if (!expense) {
    return res.status(404).json({ message: "Expense not found." });
  }
  await Expense.findByIdAndDelete(expense._id);
  res.status(200).json({ message: "Expense deleted." });
}

export async function getExpenseHistory(req, res) {
  const expense = await Expense.findById(req.params.id).lean();
  if (!expense) {
    return res.status(404).json({ message: "Expense not found." });
  }
  res.status(200).json(buildHistory(expense));
}

export async function getExpenseStats(req, res) {
  const expenses = await Expense.find({}).lean();
  const active = expenses.filter((e) => e.status !== "cancelled");
  const todayStr = today();
  const monthPrefix = todayStr.slice(0, 7);
  const sum = (list) => list.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  const categories = {};
  for (const e of active) {
    const key = e.category || "Other";
    categories[key] = (categories[key] || 0) + (Number(e.amount) || 0);
  }

  const stats = {
    totalExpenses: expenses.length,
    totalAmount: sum(active),
    todayExpenses: sum(active.filter((e) => e.expenseDate === todayStr)),
    todayCount: active.filter((e) => e.expenseDate === todayStr).length,
    monthExpenses: active.filter((e) => e.expenseDate && e.expenseDate.startsWith(monthPrefix)).length,
    monthAmount: sum(active.filter((e) => e.expenseDate && e.expenseDate.startsWith(monthPrefix))),
    pendingExpenses: expenses.filter((e) => e.status === "pending").length,
    pendingAmount: sum(expenses.filter((e) => e.status === "pending")),
    paidExpenses: expenses.filter((e) => e.status === "paid").length,
    paidAmount: sum(expenses.filter((e) => e.status === "paid")),
    categories: Object.entries(categories)
      .map(([category, total]) => ({ category, total, count: active.filter((e) => e.category === category).length }))
      .sort((a, b) => b.total - a.total),
  };
  res.status(200).json(stats);
}
