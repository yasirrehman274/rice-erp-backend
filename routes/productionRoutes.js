import { Router } from "express";
import {
  getAllProductions,
  getProductionById,
  createProduction,
  importProduction,
  updateProduction,
  deleteProduction,
  getProductionStats,
  getProductionHistory,
} from "../controllers/productionController.js";

const router = Router();

router.get("/", getAllProductions);
router.get("/stats", getProductionStats);
router.get("/history", getProductionHistory);
router.post("/import", importProduction);
router.post("/", createProduction);
router.get("/:id", getProductionById);
router.put("/:id", updateProduction);
router.delete("/:id", deleteProduction);

export default router;
