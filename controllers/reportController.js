import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import Supplier from "../models/Supplier.js";
import Customer from "../models/Customer.js";
import Warehouse from "../models/Warehouse.js";
import InventoryItem from "../models/InventoryItem.js";
import Expense from "../models/Expense.js";

export async function getDashboardData(req, res) {
  const [purchases, sales, products, suppliers, customers, warehouses, inventory, expenses] = await Promise.all([
    Purchase.find({}).lean(),
    Sale.find({}).lean(),
    Product.find({}).lean(),
    Supplier.find({}).lean(),
    Customer.find({}).lean(),
    Warehouse.find({}).lean(),
    InventoryItem.find({}).lean(),
    Expense.find({}).lean(),
  ]);

  const totalPurchases = purchases.reduce((sum, p) => sum + p.grandTotal, 0);
  const totalSales = sales.reduce((sum, s) => sum + s.grandTotal, 0);
  const totalExpenses = expenses
    .filter((e) => e.status !== "cancelled")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalInventory = inventory.reduce((sum, item) => sum + item.currentStock, 0);
  const lowStockItems = inventory.filter((item) => item.currentStock <= item.minimumStock).length;

  res.status(200).json({
    totalPurchases,
    totalSales,
    totalExpenses,
    profit: totalSales - totalPurchases,
    netProfit: totalSales - totalPurchases - totalExpenses,
    totalInventory,
    lowStockItems,
    activeSuppliers: suppliers.filter((s) => s.status === "active").length,
    activeCustomers: customers.filter((c) => c.status === "active").length,
    activeWarehouses: warehouses.filter((w) => w.status === "active").length,
    activeProducts: products.filter((p) => p.status === "active").length,
  });
}

export async function getProfitLossData(req, res) {
  const [purchases, sales, expenses] = await Promise.all([
    Purchase.find({}).lean(),
    Sale.find({}).lean(),
    Expense.find({}).lean(),
  ]);

  const totalSales = sales.reduce((sum, s) => sum + s.grandTotal, 0);
  const totalPurchases = purchases.reduce((sum, p) => sum + p.grandTotal, 0);
  const totalSalesDiscount = sales.reduce((sum, s) => sum + s.discount, 0);
  const totalPurchaseDiscount = purchases.reduce((sum, p) => sum + p.discount, 0);
  const totalTransportOut = sales.reduce((sum, s) => sum + s.transportCharges, 0);
  const totalTransportIn = purchases.reduce((sum, p) => sum + p.transportCharges, 0);
  const totalOtherOut = sales.reduce((sum, s) => sum + s.otherCharges, 0);
  const totalOtherIn = purchases.reduce((sum, p) => sum + p.otherCharges, 0);
  const netSales = totalSales - totalSalesDiscount;
  const netPurchases = totalPurchases - totalPurchaseDiscount;
  const grossProfit = netSales - netPurchases;
  const totalExpenses = totalTransportOut + totalOtherOut;
  const expenseTotal = expenses
    .filter((e) => e.status !== "cancelled")
    .reduce((sum, e) => sum + e.amount, 0);
  const expenseCount = expenses.filter((e) => e.status !== "cancelled").length;
  const totalOperatingExpenses = totalExpenses + expenseTotal;
  const netProfit = grossProfit - totalExpenses - expenseTotal;

  res.status(200).json({
    totalSales,
    totalPurchases,
    totalSalesDiscount,
    totalPurchaseDiscount,
    totalTransportIn,
    totalTransportOut,
    totalOtherIn,
    totalOtherOut,
    netSales,
    netPurchases,
    grossProfit,
    totalExpenses,
    expenseTotal,
    expenseCount,
    totalOperatingExpenses,
    netProfit,
  });
}
