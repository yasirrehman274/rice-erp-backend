import { Router } from "express";
import { getDashboardData, getProfitLossData, getInventoryReport, getCogsReport } from "../controllers/reportController.js";

const router = Router();

router.get("/dashboard", getDashboardData);
router.get("/profit-loss", getProfitLossData);
router.get("/inventory", getInventoryReport);
router.get("/cogs", getCogsReport);

export default router;
