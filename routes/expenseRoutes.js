import { Router } from "express";
import {
  getAllExpenses,
  getExpenseById,
  createExpense,
  importExpense,
  updateExpense,
  deleteExpense,
  getExpenseHistory,
  getExpenseStats,
} from "../controllers/expenseController.js";

const router = Router();

router.get("/", getAllExpenses);
router.get("/stats", getExpenseStats);
router.get("/history/:id", getExpenseHistory);
router.post("/import", importExpense);
router.post("/", createExpense);
router.get("/:id", getExpenseById);
router.put("/:id", updateExpense);
router.delete("/:id", deleteExpense);

export default router;
