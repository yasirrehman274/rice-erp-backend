import { Router } from "express";
import {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerOrders,
  getCustomerLedger,
} from "../controllers/customerController.js";

const router = Router();

router.get("/", getAllCustomers);
router.get("/:id/ledger", getCustomerLedger);
router.get("/:id/orders", getCustomerOrders);
router.get("/:id", getCustomerById);
router.post("/", createCustomer);
router.put("/:id", updateCustomer);
router.delete("/:id", deleteCustomer);

export default router;
