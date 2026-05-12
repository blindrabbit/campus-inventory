import fs from "fs";
import path from "path";
import { Router } from "express";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryRoles,
} from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";
import {
  createBackup,
  restoreBackup,
  getLockStatus,
} from "../services/backup.js";

const router = Router();

// Allowed roles for backup operations
const BACKUP_ROLES = ["ADMIN_CICLO"];

// ─── GET /api/backups — list backups for the active inventory ─────────────────
router.get(
  "/",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      const records = await prisma.backupRecord.findMany({
        where: { inventoryId: req.inventoryId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, inventoryId: true, createdBy: true, createdAt: true,
          label: true, fileName: true, filePath: true, fileSizeBytes: true,
          status: true, errorMessage: true, isScheduled: true, dedupCount: true,
          // contentHash é dado interno — não exposto
        },
      });
      return res.json(records);
    } catch (err) {
      console.error("[backup] list error:", err);
      return res.status(500).json({ error: "Erro ao listar backups" });
    }
  },
);

// ─── GET /api/backups/lock-status — check if inventory is locked ──────────────
router.get(
  "/lock-status",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const lock = await getLockStatus(req.inventoryId);
      return res.json({ locked: !!lock, lock: lock || null });
    } catch (err) {
      return res.status(500).json({ error: "Erro ao verificar lock" });
    }
  },
);

// ─── GET /api/backups/schedule — get scheduled backup config ──────────────────
router.get(
  "/schedule",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      const schedule = await prisma.backupSchedule.findUnique({
        where: { inventoryId: req.inventoryId },
      });
      return res.json(schedule || null);
    } catch (err) {
      return res.status(500).json({ error: "Erro ao buscar agendamento" });
    }
  },
);

// ─── POST /api/backups — create manual backup ─────────────────────────────────
router.post(
  "/",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      const lock = await getLockStatus(req.inventoryId);
      if (lock) {
        return res.status(423).json({
          error: `Sistema bloqueado: operação de ${lock.reason.toLowerCase()} em andamento`,
        });
      }

      const { label } = req.body;
      const record = await createBackup({
        inventoryId: req.inventoryId,
        createdBy: req.user.sub,
        label: label || null,
      });

      return res.status(201).json(record);
    } catch (err) {
      console.error("[backup] create error:", err);
      return res.status(500).json({ error: err.message || "Erro ao criar backup" });
    }
  },
);

// ─── POST /api/backups/schedule — create or update scheduled backup ───────────
router.post(
  "/schedule",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      const { intervalHours } = req.body;
      if (!intervalHours || intervalHours < 1) {
        return res.status(400).json({ error: "intervalHours deve ser >= 1" });
      }

      const nextRunAt = new Date(Date.now() + Number(intervalHours) * 60 * 60 * 1000);

      const schedule = await prisma.backupSchedule.upsert({
        where: { inventoryId: req.inventoryId },
        create: {
          inventoryId: req.inventoryId,
          intervalHours: Number(intervalHours),
          nextRunAt,
          createdBy: req.user.sub,
          isActive: true,
        },
        update: {
          intervalHours: Number(intervalHours),
          nextRunAt,
          isActive: true,
        },
      });

      return res.json(schedule);
    } catch (err) {
      console.error("[backup] schedule upsert error:", err);
      return res.status(500).json({ error: "Erro ao salvar agendamento" });
    }
  },
);

// ─── DELETE /api/backups/schedule — remove scheduled backup ──────────────────
router.delete(
  "/schedule",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      await prisma.backupSchedule.deleteMany({ where: { inventoryId: req.inventoryId } });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "Erro ao remover agendamento" });
    }
  },
);

// ─── GET /api/backups/:id/download — stream SQL file ─────────────────────────
router.get(
  "/:id/download",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      const record = await prisma.backupRecord.findUnique({
        where: { id: req.params.id },
      });

      if (!record || record.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Backup não encontrado" });
      }
      if (!fs.existsSync(record.filePath)) {
        return res.status(410).json({ error: "Arquivo não encontrado no servidor" });
      }

      res.setHeader("Content-Type", "application/sql");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${record.fileName}"`,
      );
      return fs.createReadStream(record.filePath).pipe(res);
    } catch (err) {
      return res.status(500).json({ error: "Erro ao baixar backup" });
    }
  },
);

// ─── POST /api/backups/:id/restore — restore from backup ─────────────────────
router.post(
  "/:id/restore",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      const record = await prisma.backupRecord.findUnique({
        where: { id: req.params.id },
      });

      if (!record || record.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Backup não encontrado" });
      }

      const lock = await getLockStatus(req.inventoryId);
      if (lock) {
        return res.status(423).json({
          error: `Sistema bloqueado: operação de ${lock.reason.toLowerCase()} em andamento`,
        });
      }

      await restoreBackup({ backupId: req.params.id, requestedBy: req.user.sub });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[backup] restore error:", err);
      return res.status(500).json({ error: err.message || "Erro ao restaurar backup" });
    }
  },
);

// ─── DELETE /api/backups/:id — delete backup record + file ───────────────────
router.delete(
  "/:id",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles(...BACKUP_ROLES),
  async (req, res) => {
    try {
      const record = await prisma.backupRecord.findUnique({
        where: { id: req.params.id },
      });

      if (!record || record.inventoryId !== req.inventoryId) {
        return res.status(404).json({ error: "Backup não encontrado" });
      }

      // Delete file if exists
      if (fs.existsSync(record.filePath)) {
        fs.unlinkSync(record.filePath);
      }

      await prisma.backupRecord.delete({ where: { id: req.params.id } });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "Erro ao deletar backup" });
    }
  },
);

export default router;
