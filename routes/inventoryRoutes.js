import { Router } from "express";
import {
  getAllInventory,
  getInventoryById,
  createInventoryItem,
  recomputeAll,
  adjustStock,
  transferStock,
  getStockLedger,
} from "../controllers/inventoryController.js";

const router = Router();

router.get("/", getAllInventory);
router.post("/", createInventoryItem);
router.post("/recompute", recomputeAll);
router.get("/:id/ledger", getStockLedger);
router.post("/:id/adjust", adjustStock);
router.post("/:id/transfer", transferStock);
router.get("/:id", getInventoryById);

export default router;
