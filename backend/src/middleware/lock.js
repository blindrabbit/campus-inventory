import { getLockStatus } from "../services/backup.js";

/**
 * Middleware that blocks write operations while a backup or restore is running.
 * Reads inventoryId from the same sources as requireInventoryAccess().
 */
export function requireNotLocked() {
  return async (req, res, next) => {
    try {
      const inventoryId =
        req.query.inventoryId?.toString() ||
        req.body?.inventoryId?.toString() ||
        req.params.inventoryId?.toString() ||
        req.headers["x-inventory-id"]?.toString() ||
        null;

      if (!inventoryId) return next();

      const lock = await getLockStatus(inventoryId);
      if (lock) {
        return res.status(423).json({
          error: `Sistema temporariamente bloqueado para ${lock.reason === "BACKUP" ? "backup" : "restauração"}. Tente novamente em instantes.`,
          locked: true,
          reason: lock.reason,
        });
      }

      return next();
    } catch {
      return next();
    }
  };
}
