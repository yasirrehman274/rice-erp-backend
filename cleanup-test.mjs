import mongoose from "mongoose";

const uri = "mongodb://localhost:27017/rice-erp";

const collections = [
  "products",
  "customers",
  "purchases",
  "sales",
  "inventoryitems",
  "inventoryadjustments",
  "inventorytransfers",
];

await mongoose.connect(uri);
const db = mongoose.connection.db;

const productIds = ["tst-001", "tst-002"];
const customerIds = ["tst-001", "tst-002"];
const idPrefixes = ["tpur-", "tsal-", "tadj-", "ttrf-", "tinv-", "dbg-"];

const isTestId = (id) =>
  productIds.includes(id) ||
  customerIds.includes(id) ||
  idPrefixes.some((p) => String(id).startsWith(p));

for (const name of collections) {
  const docs = await db.collection(name).find({}, { _id: 1 }).toArray();
  const ids = docs.map((d) => d._id).filter((id) => isTestId(id));
  const productFilter = name === "inventoryitems"
    ? { productId: { $in: productIds } }
    : name === "inventoryadjustments" || name === "inventorytransfers"
      ? { productId: { $in: productIds } }
      : null;
  let deleted = 0;
  if (ids.length > 0) {
    const res = await db.collection(name).deleteMany({ _id: { $in: ids } });
    deleted += res.deletedCount;
  }
  if (productFilter) {
    const res = await db.collection(name).deleteMany(productFilter);
    deleted += res.deletedCount;
  }
  if (deleted > 0) console.log(`cleaned ${name}: ${deleted}`);
}

await mongoose.disconnect();
console.log("cleanup done");
