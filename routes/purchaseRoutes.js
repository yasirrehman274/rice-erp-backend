import { Router } from "express";
import {
  getAllPurchases,
  getPurchaseById,
  createPurchase,
  importPurchase,
  updatePurchase,
  deletePurchase,
  getPurchasePayments,
  addPurchasePayment,
  updatePurchasePayment,
  deletePurchasePayment,
  receivePurchase,
  getPurchaseHistory,
} from "../controllers/purchaseController.js";

const router = Router();

router.get("/", getAllPurchases);
router.get("/history", getPurchaseHistory);
router.get("/:id/payments", getPurchasePayments);
router.post("/:id/payments", addPurchasePayment);
router.put("/:id/payments/:paymentId", updatePurchasePayment);
router.delete("/:id/payments/:paymentId", deletePurchasePayment);
router.post("/:id/receive", receivePurchase);
router.get("/:id", getPurchaseById);
router.post("/import", importPurchase);
router.post("/", createPurchase);
router.put("/:id", updatePurchase);
router.delete("/:id", deletePurchase);

export default router;
