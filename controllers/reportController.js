import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import Supplier from "../models/Supplier.js";
import Customer from "../models/Customer.js";
import Warehouse from "../models/Warehouse.js";
import InventoryItem from "../models/InventoryItem.js";
import Expense from "../models/Expense.js";
import Production from "../models/Production.js";
import {
  resolveDateRange,
  inRange,
  calcCOGS,
  calcInventoryValue,
  calcInventoryReport,
  calcProfitLoss,
  calcPurchaseSummary,
} from "../services/reportServices.js";

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

  const range = resolveDateRange(req.query);
  const purchaseSummary = calcPurchaseSummary(purchases, range);
  const profitLoss = calcProfitLoss({ sales, expenses, inventory, range });
  const inventoryValue = calcInventoryValue({ inventory, products });

  res.status(200).json({
    period: range,
    purchaseSummary: {
      orderCount: purchaseSummary.orderCount,
      total: purchaseSummary.total,
      discount: purchaseSummary.discount,
      transportCharges: purchaseSummary.transportCharges,
      otherCharges: purchaseSummary.otherCharges,
      netTotal: purchaseSummary.netTotal,
      avgPerOrder: purchaseSummary.orderCount > 0 ? purchaseSummary.total / purchaseSummary.orderCount : 0,
    },
    profitLoss: {
      grossSales: profitLoss.grossSales,
      salesDiscount: profitLoss.salesDiscount,
      netSales: profitLoss.netSales,
      cogs: profitLoss.cogs.total,
      cogsDetail: profitLoss.cogs.items,
      grossProfit: profitLoss.grossProfit,
      operatingExpenses: profitLoss.operatingExpenses,
      expenseCount: profitLoss.expenseCount,
      netProfit: profitLoss.netProfit,
    },
    inventoryValue: {
      totalBags: inventoryValue.totalBags,
      totalValue: inventoryValue.totalValue,
      lowStockItems: inventoryValue.lowStockCount,
      outOfStockItems: inventoryValue.outOfStockCount,
    },
    totalPurchases: purchaseSummary.total,
    totalSales: profitLoss.netSales,
    totalExpenses: profitLoss.operatingExpenses,
    totalInventory: inventoryValue.totalBags,
    lowStockItems: inventoryValue.lowStockCount,
    activeSuppliers: suppliers.filter((s) => s.status === "active").length,
    activeCustomers: customers.filter((c) => c.status === "active").length,
    activeWarehouses: warehouses.filter((w) => w.status === "active").length,
    activeProducts: products.filter((p) => p.status === "active").length,
  });
}

export async function getProfitLossData(req, res) {
  const [sales, expenses, inventory] = await Promise.all([
    Sale.find({}).lean(),
    Expense.find({}).lean(),
    InventoryItem.find({}).lean(),
  ]);

  const range = resolveDateRange(req.query);
  const pl = calcProfitLoss({ sales, expenses, inventory, range });

  res.status(200).json({
    period: range,
    grossSales: pl.grossSales,
    salesDiscount: pl.salesDiscount,
    transportCharges: pl.transportCharges,
    otherCharges: pl.otherCharges,
    netSales: pl.netSales,
    cogs: pl.cogs.total,
    cogsDetail: pl.cogs.items,
    grossProfit: pl.grossProfit,
    operatingExpenses: pl.operatingExpenses,
    expenseCount: pl.expenseCount,
    expenseCategories: pl.expenseCategories,
    netProfit: pl.netProfit,
  });
}

export async function getInventoryReport(req, res) {
  const [inventory, products, purchases, sales, productions] = await Promise.all([
    InventoryItem.find({}).lean(),
    Product.find({}).lean(),
    Purchase.find({}).lean(),
    Sale.find({}).lean(),
    Production.find({}).lean(),
  ]);

  const range = resolveDateRange(req.query);
  const report = calcInventoryReport({ inventory, purchases, sales, productions, range });
  const valuation = calcInventoryValue({ inventory, products });

  res.status(200).json({
    period: range,
    report,
    valuation: {
      totalBags: valuation.totalBags,
      totalValue: valuation.totalValue,
      byProduct: valuation.byProduct,
    },
  });
}

export async function getCogsReport(req, res) {
  const [sales, inventory, products] = await Promise.all([
    Sale.find({}).lean(),
    InventoryItem.find({}).lean(),
    Product.find({}).lean(),
  ]);

  const range = resolveDateRange(req.query);
  const activeSales = sales.filter((s) => s.status !== "cancelled" && inRange(s.saleDate, range));
  const cogs = calcCOGS(activeSales, inventory);
  const valuation = calcInventoryValue({ inventory, products });

  res.status(200).json({
    period: range,
    cogs,
    inventoryValue: {
      totalBags: valuation.totalBags,
      totalValue: valuation.totalValue,
    },
  });
}
