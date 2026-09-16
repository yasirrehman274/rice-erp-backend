import { Router } from "express";
import {
  getAllBrokers,
  getBrokerById,
  createBroker,
  updateBroker,
  deleteBroker,
  getBrokerDeals,
  getBrokerReport,
} from "../controllers/brokerController.js";

const router = Router();

router.get("/report", getBrokerReport);
router.get("/", getAllBrokers);
router.get("/:id/deals", getBrokerDeals);
router.get("/:id", getBrokerById);
router.post("/", createBroker);
router.put("/:id", updateBroker);
router.delete("/:id", deleteBroker);

export default router;