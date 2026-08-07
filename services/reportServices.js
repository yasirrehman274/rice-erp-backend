function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toISO(d);
}

function monthBounds(offsetMonths) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  return { start: toISO(first), end: toISO(last) };
}

export function resolveDateRange(query = {}) {
  const { period = "all", start, end } = query;
  switch (period) {
    case "today":
      return { start: todayISO(), end: todayISO() };
    case "yesterday":
      return { start: todayISO(-1), end: todayISO(-1) };
    case "last7":
      return { start: todayISO(-6), end: todayISO() };
    case "thisMonth":
      return monthBounds(0);
    case "lastMonth":
      return monthBounds(-1);
    case "custom": {
      const s = start || todayISO();
      const e = end || todayISO();
      return s <= e ? { start: s, end: e } : { start: e, end: s };
    }
    case "all":
    default:
      return { start: null, end: null };
  }
}

export function inRange(dateStr, range) {
  if (!dateStr) return false;
  if (range.start && dateStr < range.start) return false;
  if (range.end && dateStr > range.end) return false;
  return true;
}

export function isActiveSale(sale) {
  return sale.status !== "cancelled";
}

export function isActivePurchase(purchase) {
  return purchase.status !== "cancelled";
}

export function isActiveExpense(expense) {
  return expense.status !== "cancelled";
}

export function saleItems(sale) {
  if (Array.isArray(sale.items) && sale.items.length > 0) return sale.items;
  return [
    {
      productId: sale.productId,
      productName: sale.productName,
      quantity: Number(sale.quantity) || 0,
      bagWeight: Number(sale.bagWeight) || 0,
      subtotal: Number(sale.subtotal) || 0,
    },
  ];
}

function productBagWeight(products, productId) {
  const product = products.find((p) => String(p._id) === String(productId));
  const match = String(product?.bagWeight ?? "").match(/\d+(\.\d+)?/);
  const parsed = match ? parseFloat(match[0]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function blendedAvgCostPerProduct(inventory) {
  const weighted = new Map();
  for (const item of inventory) {
    const entry = weighted.get(String(item.productId)) ?? { costWeight: 0, bags: 0 };
    entry.bags += item.currentStock;
    entry.costWeight += item.currentStock * (Number(item.averageCostPerKG) || 0);
    weighted.set(String(item.productId), entry);
  }
  const result = new Map();
  for (const [productId, entry] of weighted) {
    const fallback = inventory.find((i) => String(i.productId) === String(productId))?.averageCostPerKG ?? 0;
    result.set(productId, {
      costPerKG: entry.bags > 0 ? entry.costWeight / entry.bags : fallback,
      bags: entry.bags,
    });
  }
  return result;
}

export function calcCOGS(sales, inventory) {
  const costs = blendedAvgCostPerProduct(inventory);
  const rows = new Map();
  for (const sale of sales) {
    if (!isActiveSale(sale)) continue;
    for (const item of saleItems(sale)) {
      const costPerKG = costs.get(String(item.productId))?.costPerKG ?? 0;
      const bags = Number(item.quantity) || 0;
      const bagWeight = Number(item.bagWeight) || 0;
      if (bags <= 0) continue;
      const costPerBag = round2(costPerKG * bagWeight);
      const row = rows.get(String(item.productId)) ?? { productId: String(item.productId), productName: item.productName, bags: 0, bagWeight, costPerBag, total: 0 };
      row.bags += bags;
      row.total = round2(row.total + bags * costPerBag);
      rows.set(String(item.productId), row);
    }
  }
  const items = Array.from(rows.values())
    .map((row) => ({ ...row, costPerBag: round2(row.total / row.bags) }))
    .sort((a, b) => b.total - a.total);
  return { total: round2(items.reduce((sum, row) => sum + row.total, 0)), items };
}

export function calcInventoryValue({ inventory, products }) {
  const bagWeight = new Map();
  for (const product of products) bagWeight.set(String(product._id), productBagWeight(products, product._id));
  const byProduct = new Map();
  let totalBags = 0;
  for (const item of inventory) {
    totalBags += item.currentStock;
    if (item.currentStock <= 0) continue;
    const weight = bagWeight.get(String(item.productId)) ?? 0;
    const costPerBag = round2((Number(item.averageCostPerKG) || 0) * weight);
    const entry = byProduct.get(String(item.productId)) ?? { productId: String(item.productId), productName: item.productName, bags: 0, costPerBag, value: 0 };
    entry.bags += item.currentStock;
    entry.value = round2(entry.value + item.currentStock * costPerBag);
    byProduct.set(String(item.productId), entry);
  }
  const items = Array.from(byProduct.values())
    .map((entry) => ({ ...entry, costPerBag: entry.bags > 0 ? round2(entry.value / entry.bags) : 0 }))
    .sort((a, b) => b.value - a.value);
  return {
    totalBags: round2(totalBags),
    totalValue: round2(items.reduce((sum, entry) => sum + entry.value, 0)),
    lowStockCount: inventory.filter((item) => item.currentStock > 0 && item.currentStock <= item.minimumStock).length,
    outOfStockCount: inventory.filter((item) => item.currentStock <= 0).length,
    byProduct: items,
  };
}

export function calcInventoryReport({ inventory, purchases, sales, productions, range }) {
  const movements = new Map();
  const names = new Map();
  const track = (productId) => {
    const key = String(productId);
    if (!movements.has(key)) movements.set(key, { purchases: 0, production: 0, sales: 0, mixing: 0 });
  };

  for (const purchase of purchases) {
    if (!isActivePurchase(purchase) || !inRange(purchase.purchaseDate, range)) continue;
    track(purchase.productId);
    const entry = movements.get(String(purchase.productId));
    entry.purchases += Number(purchase.quantity) || 0;
    names.set(String(purchase.productId), purchase.productName || names.get(String(purchase.productId)) || "");
  }

  for (const production of productions) {
    if (production.status === "cancelled" || !inRange(production.productionDate, range)) continue;
    if (production.outputProductId) {
      track(production.outputProductId);
      const entry = movements.get(String(production.outputProductId));
      entry.production += Number(production.outputBags) || 0;
      names.set(String(production.outputProductId), production.outputProductName || names.get(String(production.outputProductId)) || "");
    }
    for (const material of production.materials ?? []) {
      track(material.productId);
      const entry = movements.get(String(material.productId));
      entry.mixing += Number(material.quantityUsed) || 0;
      names.set(String(material.productId), material.productName || names.get(String(material.productId)) || "");
    }
  }

  for (const sale of sales) {
    if (!isActiveSale(sale) || !inRange(sale.saleDate, range)) continue;
    for (const item of saleItems(sale)) {
      track(item.productId);
      const entry = movements.get(String(item.productId));
      entry.sales += Number(item.quantity) || 0;
      names.set(String(item.productId), item.productName || names.get(String(item.productId)) || "");
    }
  }

  const currentStock = new Map();
  for (const item of inventory) {
    currentStock.set(String(item.productId), (currentStock.get(String(item.productId)) ?? 0) + item.currentStock);
    names.set(String(item.productId), item.productName || names.get(String(item.productId)) || "");
  }

  const rows = Array.from(movements.keys())
    .map((productId) => {
      const entry = movements.get(productId);
      const closing = round2(currentStock.get(productId) ?? 0);
      const opening = round2(closing - entry.purchases - entry.production + entry.sales + entry.mixing);
      return {
        productId,
        productName: names.get(productId) ?? "",
        opening,
        purchases: round2(entry.purchases),
        production: round2(entry.production),
        sales: round2(entry.sales),
        mixing: round2(entry.mixing),
        closing,
        change: round2(closing - opening),
      };
    })
    .sort((a, b) => b.closing - a.closing);

  const sum = (picker) => round2(rows.reduce((acc, row) => acc + picker(row), 0));
  return {
    rows,
    totalOpening: sum((r) => r.opening),
    totalPurchases: sum((r) => r.purchases),
    totalProduction: sum((r) => r.production),
    totalSales: sum((r) => r.sales),
    totalMixing: sum((r) => r.mixing),
    totalClosing: sum((r) => r.closing),
  };
}

export function calcProfitLoss({ sales, expenses, inventory, range }) {
  const activeSales = sales.filter((s) => isActiveSale(s) && inRange(s.saleDate, range));
  const activeExpenses = expenses.filter((e) => isActiveExpense(e) && inRange(e.expenseDate, range));

  const grossSales = round2(activeSales.reduce((sum, s) => sum + (Number(s.subtotal) || 0), 0));
  const salesDiscount = round2(activeSales.reduce((sum, s) => sum + (Number(s.discount) || 0), 0));
  const transportCharges = round2(activeSales.reduce((sum, s) => sum + (Number(s.transportCharges) || 0), 0));
  const otherCharges = round2(activeSales.reduce((sum, s) => sum + (Number(s.otherCharges) || 0), 0));
  const netSales = round2(activeSales.reduce((sum, s) => sum + (Number(s.grandTotal) || 0), 0));
  const cogs = calcCOGS(activeSales, inventory);
  const grossProfit = round2(netSales - cogs.total);

  const operatingExpenses = round2(activeExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));
  const categoryMap = new Map();
  for (const expense of activeExpenses) {
    const key = expense.category || "Other";
    const entry = categoryMap.get(key) ?? { total: 0, count: 0 };
    entry.total += Number(expense.amount) || 0;
    entry.count += 1;
    categoryMap.set(key, entry);
  }
  const expenseCategories = Array.from(categoryMap.entries())
    .map(([category, value]) => ({ category, total: round2(value.total), count: value.count }))
    .sort((a, b) => b.total - a.total);

  return {
    grossSales,
    salesDiscount,
    transportCharges,
    otherCharges,
    netSales,
    cogs,
    grossProfit,
    operatingExpenses,
    expenseCount: activeExpenses.length,
    expenseCategories,
    netProfit: round2(grossProfit - operatingExpenses),
  };
}

export function calcPurchaseSummary(purchases, range) {
  const active = purchases.filter((p) => isActivePurchase(p) && inRange(p.purchaseDate, range));
  const total = round2(active.reduce((sum, p) => sum + (Number(p.grandTotal) || 0), 0));
  const discount = round2(active.reduce((sum, p) => sum + (Number(p.discount) || 0), 0));
  const transportCharges = round2(active.reduce((sum, p) => sum + (Number(p.transportCharges) || 0), 0));
  const otherCharges = round2(active.reduce((sum, p) => sum + (Number(p.otherCharges) || 0), 0));
  return {
    orderCount: active.length,
    total,
    discount,
    transportCharges,
    otherCharges,
    netTotal: round2(total - discount + transportCharges + otherCharges),
  };
}
