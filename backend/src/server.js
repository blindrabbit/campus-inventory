import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.routes.js";
import spaceRoutes from "./routes/space.routes.js";
import itemRoutes from "./routes/item.routes.js";
import itemGroupRoutes from "./routes/item-group.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import exportRoutes from "./routes/export.routes.js";
import inventoryRoutes from "./routes/inventory.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import eventsRoutes from "./routes/events.routes.js";
import { ensureSpaceCountersTable } from "./services/metrics.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import backupRoutes from "./routes/backup.routes.js";
import { startBackupScheduler, ensureBackupDir } from "./services/backup.js";
import { requireNotLocked } from "./middleware/lock.js";

const app = express();
const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (
  isProduction &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("dev-secret"))
) {
  throw new Error(
    "JWT_SECRET inválido para produção. Defina um segredo forte antes de iniciar.",
  );
}

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests server-to-server (sem Origin) e ambientes sem allow-list em dev.
      if (!origin || (!isProduction && allowedOrigins.length === 0)) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS_BLOCKED"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));

// Lock middleware: bloqueia escrita em inventários em backup/restore
const lockMiddleware = requireNotLocked();

// Rotas
app.use("/api/auth", authRoutes);
app.use("/api/spaces", lockMiddleware, spaceRoutes);
app.use("/api/items", lockMiddleware, itemRoutes);
app.use("/api/item-groups", lockMiddleware, itemGroupRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/inventories", lockMiddleware, inventoryRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/backups", backupRoutes);

// Health check
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", timestamp: new Date() }),
);

app.use((err, req, res, next) => {
  if (err?.message === "CORS_BLOCKED") {
    return res.status(403).json({ error: "Origem não autorizada" });
  }
  return next(err);
});

const PORT = process.env.PORT || 8000;
(async () => {
  try {
    await ensureSpaceCountersTable();
    ensureBackupDir();
    startBackupScheduler();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Backend rodando em http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to initialize backend:", err);
    process.exit(1);
  }
})();
