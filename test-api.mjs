const BASE = "http://localhost:4000/api";

let passed = 0;
let failed = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// clean slate for the test ids
for (const id of ["tst-001", "tst-002"]) {
  await api(`/products/${id}`, { method: "DELETE" });
  await api(`/customers/${id}`, { method: "DELETE" });
}
for (const id of ["tpur-001", "tpur-002", "tpur-003", "tpur-100", "tsal-001", "tsal-002", "tsal-100", "tadj-001", "ttrf-001"]) {
  await api(`/purchases/${id}`, { method: "DELETE" });
  await api(`/sales/${id}`, { method: "DELETE" });
}

const today = new Date().toISOString().slice(0, 10);

// ---- 1. Product CRUD
let r = await api("/products", { method: "POST", body: { id: "tst-001", productName: "Test Rice 50kg", riceCode: "TST-50", category: "Test", brand: "TestBrand", variety: "Long", unit: "Bag", bagWeight: "50", lastPurchasePrice: 5000, suggestedSalePrice: 6000, minimumStock: 50, description: "", status: "active", createdDate: today } });
ok("create product", r.status === 201 && r.data?._id === "tst-001", JSON.stringify(r.data));
r = await api("/products/tst-001");
ok("get product", r.status === 200 && r.data?.productName === "Test Rice 50kg");
await api("/products", { method: "POST", body: { id: "tst-002", productName: "Test Rice 2", riceCode: "TST2-50", category: "Test", unit: "Bag" } });
r = await api("/products", { method: "POST", body: { id: "tst-003", productName: "Test Rice 3", riceCode: "TST2-50", category: "Test", unit: "Bag" } });
ok("duplicate riceCode -> 409", r.status === 409, `got ${r.status}`);
r = await api("/products/tst-002", { method: "PUT", body: { productName: "Test Rice 2", riceCode: "TST2-50", category: "Test", brand: "", variety: "", unit: "Bag", bagWeight: "50", lastPurchasePrice: 0, suggestedSalePrice: 0, minimumStock: 0, description: "", status: "active" } });
ok("update product", r.status === 200 && r.data?.riceCode === "TST2-50", JSON.stringify(r.data));
await api("/products/tst-003", { method: "DELETE" });

// ---- 2. Customer CRUD
r = await api("/customers", { method: "POST", body: { id: "tst-001", name: "Test Customer", businessName: "TC", phone: "03331234567", whatsapp: "", email: "", cnic: "35202-1234567-1", ntn: "", city: "Lahore", address: "", openingBalance: 1000, creditLimit: 50000, status: "active", notes: "", createdAt: today } });
ok("create customer", r.status === 201 && r.data?.currentBalance === 1000, JSON.stringify(r.data));
r = await api("/customers", { method: "POST", body: { id: "tst-002", name: "Dup Customer", phone: "03331234567" } });
ok("duplicate phone -> 409", r.status === 409, `got ${r.status}`);
r = await api("/customers/tst-001/ledger");
ok("customer ledger opening", r.status === 200 && r.data?.[0]?.debit === 1000 && r.data?.[0]?.balance === 1000, JSON.stringify(r.data));

// ---- 3. Ensure warehouses + suppliers exist
const whs = (await api("/warehouses")).data;
const sups = (await api("/suppliers")).data;
ok("warehouses present", whs.length > 0);
ok("suppliers present", sups.length > 0);
const wh = whs[0];
const wh2 = whs[1] ?? whs[0];
const sup = sups[0];

// ---- 4. Purchase create -> inventory + supplier balance
const supBefore = (await api(`/suppliers/${sup._id}`)).data;
r = await api("/purchases", { method: "POST", body: { id: "tpur-001", purchaseNumber: "TST-PUR-9001", purchaseDate: today, supplierId: sup._id, warehouseId: wh._id, productId: "tst-001", batchNumber: "T-B-1", riceVariety: "Test", quantity: 100, bagWeight: 50, totalWeight: 5000, currentPurchasePrice: 5000, purchaseRate: 5000, subtotal: 500000, discount: 0, transportCharges: 10000, otherCharges: 0, grandTotal: 510000, paidAmount: 200000, remainingBalance: 310000, paymentMethod: "bank", status: "pending", paymentStatus: "partial", notes: "", createdAt: today, updatedAt: today } });
ok("create purchase", r.status === 201, JSON.stringify(r.data));
const supAfter = (await api(`/suppliers/${sup._id}`)).data;
ok("supplier balance +310000", Math.abs(supAfter.currentBalance - (supBefore.currentBalance + 310000)) < 1, `before=${supBefore.currentBalance} after=${supAfter.currentBalance}`);
ok("supplier totalPurchases +510000", Math.abs(supAfter.totalPurchases - (supBefore.totalPurchases + 510000)) < 1);
ok("supplier totalPaid +200000", Math.abs(supAfter.totalPaid - (supBefore.totalPaid + 200000)) < 1);

const invItems = (await api(`/inventory?productId=tst-001`)).data;
const invWh = invItems.find((i) => i.warehouseId === wh._id);
ok("inventory item created", !!invWh, JSON.stringify(invItems));
ok("inventory currentStock 100", invWh && invWh.currentStock === 100, JSON.stringify(invWh));
ok("inventory averageCost 5000", invWh && invWh.averageCostPerKG === 5000);
const prod = (await api("/products/tst-001")).data;
ok("product currentStock 100", prod.currentStock === 100, JSON.stringify(prod));
ok("product warehouseCount 1", prod.warehouseCount === 1);
ok("product lastPurchasePrice 5000", prod.lastPurchasePrice === 5000);
const whAfterPurchase = (await api(`/warehouses/${wh._id}`)).data;
ok("warehouse totalStock recomputed = 100", whAfterPurchase.totalStock === 100, `wh.totalStock=${wh.totalStock} after=${whAfterPurchase.totalStock}`);

// ---- 5. Second purchase (weighted avg cost)
await api("/purchases", { method: "POST", body: { id: "tpur-002", purchaseNumber: "TST-PUR-9002", purchaseDate: today, supplierId: sup._id, warehouseId: wh._id, productId: "tst-001", batchNumber: "T-B-2", riceVariety: "Test", quantity: 100, bagWeight: 50, totalWeight: 5000, currentPurchasePrice: 7000, purchaseRate: 7000, subtotal: 700000, discount: 0, transportCharges: 0, otherCharges: 0, grandTotal: 700000, paidAmount: 700000, remainingBalance: 0, paymentMethod: "cash", status: "received", paymentStatus: "paid", notes: "", createdAt: today, updatedAt: today } });
const invAfter2 = (await api(`/inventory?productId=tst-001`)).data.find((i) => i.warehouseId === wh._id);
ok("inventory currentStock 200", invAfter2.currentStock === 200, JSON.stringify(invAfter2));
ok("weighted avg cost 6000", invAfter2.averageCostPerKG === 6000, `avg=${invAfter2.averageCostPerKG}`);

// ---- 6. Sale create (stock guard)
r = await api("/sales", { method: "POST", body: { id: "tsal-001", saleNumber: "TST-SAL-9001", saleDate: today, customerId: "tst-001", warehouseId: wh._id, productId: "tst-001", batchNumber: "T-B-1", riceVariety: "Test", quantity: 60, bagWeight: 50, totalWeight: 3000, currentSalePrice: 600000, saleRate: 10000, subtotal: 600000, discount: 0, transportCharges: 5000, otherCharges: 0, grandTotal: 605000, receivedAmount: 300000, remainingBalance: 305000, paymentMethod: "cash", status: "dispatched", paymentStatus: "partial", notes: "", createdAt: today, updatedAt: today } });
ok("create sale", r.status === 201, JSON.stringify(r.data));
const cust = (await api("/customers/tst-001")).data;
ok("customer currentBalance 306000 (1000+305000)", cust.currentBalance === 306000, `cb=${cust.currentBalance}`);
const invAfterSale = (await api(`/inventory?productId=tst-001`)).data.find((i) => i.warehouseId === wh._id);
ok("inventory after sale 140", invAfterSale.currentStock === 140, JSON.stringify(invAfterSale));
const prodAfterSale = (await api("/products/tst-001")).data;
ok("product after sale 140", prodAfterSale.currentStock === 140);
ok("product suggestedSalePrice 600000", prodAfterSale.suggestedSalePrice === 600000);
const led = (await api(`/inventory/${invAfterSale._id}/ledger`)).data;
ok("stock ledger has 3 rows", led.length === 3, JSON.stringify(led));
ok("stock ledger final balance 140", led[led.length - 1].balance === 140, `bal=${led[led.length - 1].balance}`);

// ---- 7. Sale exceeding stock -> 400
r = await api("/sales", { method: "POST", body: { id: "tsal-002", saleNumber: "TST-SAL-9002", saleDate: today, customerId: "tst-001", warehouseId: wh._id, productId: "tst-001", batchNumber: "T-B-1", riceVariety: "Test", quantity: 9999, bagWeight: 50, totalWeight: 9999, currentSalePrice: 100, saleRate: 100, subtotal: 999900, discount: 0, transportCharges: 0, otherCharges: 0, grandTotal: 999900, receivedAmount: 0, remainingBalance: 999900, paymentMethod: "cash", status: "pending", paymentStatus: "unpaid", notes: "", createdAt: today, updatedAt: today } });
ok("sale over stock -> 400", r.status === 400 && r.data?.message?.includes("Insufficient stock"), JSON.stringify(r.data));

// ---- 8. Update purchase quantity 100 -> 40 (reverse+apply)
r = await api("/purchases/tpur-001", { method: "PUT", body: { purchaseNumber: "TST-PUR-9001", purchaseDate: today, supplierId: sup._id, warehouseId: wh._id, productId: "tst-001", batchNumber: "T-B-1", riceVariety: "Test", quantity: 40, bagWeight: 50, totalWeight: 2000, currentPurchasePrice: 5000, purchaseRate: 5000, subtotal: 200000, discount: 0, transportCharges: 10000, otherCharges: 0, grandTotal: 210000, paidAmount: 200000, remainingBalance: 10000, paymentMethod: "bank", status: "pending", paymentStatus: "partial", notes: "", createdAt: today, updatedAt: today } });
ok("update purchase", r.status === 200, JSON.stringify(r.data));
const invAfterUpdate = (await api(`/inventory?productId=tst-001`)).data.find((i) => i.warehouseId === wh._id);
ok("inventory after update 80 (140-60)", invAfterUpdate.currentStock === 80, JSON.stringify(invAfterUpdate));
const supAfterUpdate = (await api(`/suppliers/${sup._id}`)).data;
ok("supplier balance after update = before + 10000", Math.abs(supAfterUpdate.currentBalance - (supBefore.currentBalance + 10000)) < 1, `before=${supBefore.currentBalance} after=${supAfterUpdate.currentBalance}`);

// ---- 9. Delete purchase -> rollback
await api("/purchases/tpur-001", { method: "DELETE" });
const invAfterDel = (await api(`/inventory?productId=tst-001`)).data.find((i) => i.warehouseId === wh._id);
ok("inventory after delete 40 (80-40)", invAfterDel.currentStock === 40, JSON.stringify(invAfterDel));
const supAfterDel = (await api(`/suppliers/${sup._id}`)).data;
ok("supplier balance after delete = before", Math.abs(supAfterDel.currentBalance - supBefore.currentBalance) < 1, `before=${supBefore.currentBalance} after=${supAfterDel.currentBalance}`);
const prodAfterDel = (await api("/products/tst-001")).data;
ok("product currentStock 40", prodAfterDel.currentStock === 40);

// ---- 10. Delete sale -> restock
await api("/sales/tsal-001", { method: "DELETE" });
const invAfterSaleDel = (await api(`/inventory?productId=tst-001`)).data.find((i) => i.warehouseId === wh._id);
ok("inventory after sale delete 100 (40+60)", invAfterSaleDel.currentStock === 100, JSON.stringify(invAfterSaleDel));
const custAfterDel = (await api("/customers/tst-001")).data;
ok("customer balance back to 1000", custAfterDel.currentBalance === 1000, `cb=${custAfterDel.currentBalance}`);

// ---- 11. Adjustment
const item = (await api(`/inventory?productId=tst-001`)).data.find((i) => i.warehouseId === wh._id);
r = await api(`/inventory/${item._id}/adjust`, { method: "POST", body: { adjustmentType: "increase", quantity: 25, reason: "Test count", notes: "" } });
ok("adjust increase", r.status === 200 && r.data.currentStock === 125, JSON.stringify(r.data));
r = await api(`/inventory/${item._id}/adjust`, { method: "POST", body: { adjustmentType: "decrease", quantity: 10, reason: "Test count", notes: "" } });
ok("adjust decrease", r.status === 200 && r.data.currentStock === 115, JSON.stringify(r.data));
r = await api(`/inventory/${item._id}/adjust`, { method: "POST", body: { adjustmentType: "decrease", quantity: 9999, reason: "over", notes: "" } });
ok("adjust over stock -> 400", r.status === 400, `got ${r.status}`);

// ---- 12. Transfer
if (wh2._id !== wh._id) {
  r = await api(`/inventory/${item._id}/transfer`, { method: "POST", body: { destinationWarehouseId: wh2._id, quantity: 15, notes: "Test transfer" } });
  ok("transfer", r.status === 200 && r.data.currentStock === 100, JSON.stringify(r.data));
  const dest = (await api(`/inventory?productId=tst-001&warehouseId=${wh2._id}`)).data.find((i) => i.productId === "tst-001");
  ok("destination inventory created 15", dest && dest.currentStock === 15, JSON.stringify(dest));
  const led2 = (await api(`/inventory/${item._id}/ledger`)).data;
  ok("ledger includes transfer-out", led2.some((e) => e.type === "transfer-out"), JSON.stringify(led2.map((e) => e.type)));
  const ledDest = dest ? (await api(`/inventory/${dest._id}/ledger`)).data : [];
  ok("dest ledger includes transfer-in", ledDest.some((e) => e.type === "transfer-in"), JSON.stringify(ledDest.map((e) => e.type)));
} else {
  console.log("SKIP  transfer (single warehouse available)");
}

// ---- 13. Reports
r = await api("/reports/dashboard");
ok("dashboard report", r.status === 200 && typeof r.data.totalSales === "number" && typeof r.data.profit === "number");
r = await api("/reports/profit-loss");
ok("profit loss report", r.status === 200 && typeof r.data.netProfit === "number");

// ---- 14. Purchase payments + history
r = await api("/purchases/tpur-002/payments");
ok("purchase payments split", r.status === 200 && Array.isArray(r.data) && r.data.length >= 1, JSON.stringify(r.data));
r = await api("/purchases/history");
ok("purchase history", r.status === 200 && Array.isArray(r.data));
r = await api("/sales/history");
ok("sale history", r.status === 200 && Array.isArray(r.data));

// ---- 15. Receive + dispatch + payments
r = await api("/purchases/tpur-002/receive", { method: "POST", body: { receivedBy: "Tester" } });
ok("receive purchase", r.status === 200 && r.data.status === "received", JSON.stringify(r.data));
r = await api("/sales/tsal-002/dispatch", { method: "POST", body: { dispatchedBy: "Tester" } });
ok("dispatch sale", r.status === 200 && r.data.status === "dispatched", JSON.stringify(r.data));
r = await api("/purchases/tpur-002/payments", { method: "POST", body: { amount: 500, method: "cash" } });
ok("overpay purchase -> 400", r.status === 400, `got ${r.status}`);
await api("/purchases", { method: "POST", body: { id: "tpur-003", purchaseNumber: "TST-PUR-9003", purchaseDate: today, supplierId: sup._id, warehouseId: wh._id, productId: "tst-001", batchNumber: "T-B-3", riceVariety: "Test", quantity: 10, bagWeight: 50, totalWeight: 500, currentPurchasePrice: 5000, purchaseRate: 5000, subtotal: 50000, discount: 0, transportCharges: 0, otherCharges: 0, grandTotal: 50000, paidAmount: 10000, remainingBalance: 40000, paymentMethod: "cash", status: "pending", paymentStatus: "partial", notes: "", createdAt: today, updatedAt: today } });
r = await api("/purchases/tpur-003/payments", { method: "POST", body: { amount: 500, method: "cash" } });
ok("add purchase payment", r.status === 200 && r.data.paidAmount === 10500 && r.data.remainingBalance === 39500, JSON.stringify(r.data));
r = await api("/purchases/tpur-003/payments", { method: "POST", body: { amount: 999999, method: "cash" } });
ok("overpay purchase payment -> 400", r.status === 400, `got ${r.status}`);

// ---- 16. Product movements + customer orders
r = await api("/products/tst-001/movements");
ok("product movements", r.status === 200 && Array.isArray(r.data.purchases) && Array.isArray(r.data.sales));
r = await api("/customers/tst-001/orders");
ok("customer orders", r.status === 200 && Array.isArray(r.data));

// ---- 17. Not found + delete flows
r = await api("/products/nope-999");
ok("missing product -> 404", r.status === 404);
r = await api("/purchases/nope-999");
ok("missing purchase -> 404", r.status === 404);
r = await api("/sales/nope-999");
ok("missing sale -> 404", r.status === 404);
r = await api("/inventory/nope-999");
ok("missing inventory -> 404", r.status === 404);

// ---- 18. Migration endpoints (verbatim import, inventory create, recompute)
const supImpBefore = (await api(`/suppliers/${sup._id}`)).data;
const custImpBefore = (await api("/customers/tst-001")).data;

r = await api("/inventory", { method: "POST", body: { id: "tinv-001", productId: "tst-002", productName: "Test Rice 2", riceCode: "TST2-50", category: "Test", warehouseId: wh._id, warehouseName: wh.name, currentStock: 30, reservedStock: 0, availableStock: 30, minimumStock: 5, unit: "bags", averageCostPerKG: 5000, updatedAt: today } });
ok("inventory create 201", r.status === 201 && r.data.currentStock === 30, JSON.stringify(r.data));
const prodImp = (await api("/products/tst-002")).data;
ok("inventory create syncs product stock", prodImp.currentStock === 30, `stock=${prodImp.currentStock}`);

r = await api("/inventory", { method: "POST", body: { id: "tinv-001", productId: "tst-002", productName: "Test Rice 2", riceCode: "TST2-50", category: "Test", warehouseId: wh._id, warehouseName: wh.name, currentStock: 40, reservedStock: 0, availableStock: 40, minimumStock: 5, unit: "bags", averageCostPerKG: 5000, updatedAt: today } });
ok("inventory upsert 200", r.status === 200 && r.data.currentStock === 40, JSON.stringify(r.data));
const prodImp2 = (await api("/products/tst-002")).data;
ok("upsert syncs product stock", prodImp2.currentStock === 40, `stock=${prodImp2.currentStock}`);

r = await api("/purchases/import", { method: "POST", body: { id: "tpur-100", purchaseNumber: "IMP-PUR-1", purchaseDate: today, supplierId: sup._id, supplierName: sup.name, warehouseId: wh._id, warehouseName: wh.name, productId: "tst-002", productName: "Test Rice 2", batchNumber: "B", riceVariety: "T", quantity: 999, bagWeight: 50, totalWeight: 999, currentPurchasePrice: 5000, purchaseRate: 5000, subtotal: 999, discount: 0, transportCharges: 0, otherCharges: 0, grandTotal: 999, paidAmount: 0, remainingBalance: 999, paymentMethod: "cash", status: "pending", paymentStatus: "unpaid", notes: "", createdAt: today, updatedAt: today } });
ok("purchase import 201", r.status === 201 && r.data?._id === "tpur-100", JSON.stringify(r.data));
const supImpAfter = (await api(`/suppliers/${sup._id}`)).data;
ok("purchase import no supplier effect", Math.abs(supImpAfter.currentBalance - supImpBefore.currentBalance) < 1);
const invImpAfter = (await api(`/inventory?productId=tst-002`)).data.find((i) => i.warehouseId === wh._id);
ok("purchase import no stock effect", invImpAfter.currentStock === 40, `stock=${invImpAfter.currentStock}`);

r = await api("/sales/import", { method: "POST", body: { id: "tsal-100", saleNumber: "IMP-SAL-1", saleDate: today, customerId: "tst-001", customerName: "Test Customer", warehouseId: wh._id, warehouseName: wh.name, productId: "tst-002", productName: "Test Rice 2", batchNumber: "B", riceVariety: "T", quantity: 888, bagWeight: 50, totalWeight: 888, currentSalePrice: 10000, saleRate: 10000, subtotal: 888, discount: 0, transportCharges: 0, otherCharges: 0, grandTotal: 888, receivedAmount: 0, remainingBalance: 888, paymentMethod: "cash", status: "pending", paymentStatus: "unpaid", notes: "", createdAt: today, updatedAt: today } });
ok("sale import 201", r.status === 201 && r.data?._id === "tsal-100", JSON.stringify(r.data));
const custImpAfter = (await api("/customers/tst-001")).data;
ok("sale import no customer effect", Math.abs(custImpAfter.currentBalance - custImpBefore.currentBalance) < 1);
const invImpAfterSale = (await api(`/inventory?productId=tst-002`)).data.find((i) => i.warehouseId === wh._id);
ok("sale import no stock effect", invImpAfterSale.currentStock === 40, `stock=${invImpAfterSale.currentStock}`);

r = await api("/inventory/recompute", { method: "POST" });
ok("inventory recompute", r.status === 200 && r.data.productCount >= 1, JSON.stringify(r.data));
const whInv = (await api(`/inventory?warehouseId=${wh._id}`)).data;
const whSum = whInv.reduce((sum, i) => sum + i.currentStock, 0);
const whAfterRecompute = (await api(`/warehouses/${wh._id}`)).data;
ok("recompute syncs warehouse", whAfterRecompute.totalStock === whSum, `total=${whAfterRecompute.totalStock} sum=${whSum}`);

console.log(`\n==== RESULT: ${passed} passed, ${failed} failed ====`);
process.exit(failed > 0 ? 1 : 0);
