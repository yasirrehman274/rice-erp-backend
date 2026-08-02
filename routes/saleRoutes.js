import { Router } from "express";
import {
  getAllSales,
  getSaleById,
  createSale,
  importSale,
  updateSale,
  deleteSale,
  getSalePayments,
  addSalePayment,
  dispatchSale,
  getSaleHistory,
} from "../controllers/saleController.js";

const router = Router();

router.get("/", getAllSales);
router.get("/history", getSaleHistory);
router.get("/:id/payments", getSalePayments);
router.post("/:id/payments", addSalePayment);
router.post("/:id/dispatch", dispatchSale);
router.get("/:id", getSaleById);
router.post("/import", importSale);
router.post("/", createSale);
router.put("/:id", updateSale);
router.delete("/:id", deleteSale);

export default router;
