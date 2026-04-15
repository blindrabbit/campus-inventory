import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import { requireInventoryAccess } from "../middleware/inventory.js";
import { sseMiddleware } from "../services/sse.js";

const router = Router();

/**
 * GET /api/events/stream?spaceId=xxx
 * Server-Sent Events endpoint — clients subscribe to receive realtime
 * notifications for items in a given inventory (optionally filtered by space).
 */
router.get(
  "/stream",
  verifyJWT,
  requireInventoryAccess(),
  sseMiddleware,
);

export default router;
