import { Router } from "express";
import { getDashboardData, getProfitLossData } from "../controllers/reportController.js";

const router = Router();

router.get("/dashboard", getDashboardData);
router.get("/profit-loss", getProfitLossData);

export default router;
