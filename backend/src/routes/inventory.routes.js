import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import { verifyJWT } from "../middleware/auth.js";
import {
  requireInventoryAccess,
  requireInventoryRoles,
} from "../middleware/inventory.js";
import { prisma } from "../prisma/client.js";
import {
  ensureInventoryBootstrapForUser,
  findUserBySamAccountName,
} from "../services/inventory.js";
import { repairMojibake } from "../utils/pdf-text.js";
import {
  findDirectoryUserBySam,
  findUniqueDirectoryUserByEmployeeID,
  searchDirectoryUsers,
} from "../services/ldap.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const INVENTORY_ROLES = [
  "ADMIN_CICLO",
  "CONFERENTE",
  "REVISOR",
  "VISUALIZADOR",
];
const INVENTORY_STATUSES = [
  "NAO_INICIADO",
  "EM_EXECUCAO",
  "PAUSADO",
  "EM_AUDITORIA",
  "FINALIZADO",
  "CANCELADO",
];

const STATUS_TRANSITIONS = {
  NAO_INICIADO: ["EM_EXECUCAO", "PAUSADO", "EM_AUDITORIA", "CANCELADO"],
  EM_EXECUCAO: ["PAUSADO", "EM_AUDITORIA", "FINALIZADO", "CANCELADO"],
  PAUSADO: ["NAO_INICIADO", "EM_EXECUCAO", "EM_AUDITORIA", "CANCELADO"],
  EM_AUDITORIA: ["EM_EXECUCAO", "PAUSADO", "FINALIZADO", "CANCELADO"],
  FINALIZADO: [],
  CANCELADO: [],
};

const isValidInventoryRole = (role) => INVENTORY_ROLES.includes(role);
const isValidInventoryStatus = (status) => INVENTORY_STATUSES.includes(status);

const INVENTORY_SOURCE_TYPES = ["UPLOAD_XLSX", "REUSE_BASE"];
const XLSX_REQUIRED_COLUMNS = ["patrimonio", "descricao"];
const XLSX_ROOM_COLUMNS = ["voce digita a sala", "setor"];
const UNKNOWN_LOCATION_KEY = "SEM_LOCAL";
const MAX_IMPORT_FAILURE_SAMPLES = 30;
const PDF_REQUIRED_COLUMNS = ["patrimonio", "descricao", "localizacao"];
const PDF_HEADER_PATTERN = /seq\s+class.*cod\s*bem.*descricao.*localizacao/i;
const PDF_ROW_PATTERN =
  /^(\d{6,})\s+(\d+)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d.]+,\d{2})\s+(\d+)\s+(.+)$/i;

const normalizeColumnName = (value) =>
  value
    ?.toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const toTextOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = value.toString().trim();
  return text.length > 0 ? text : null;
};

const parseCurrency = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const cleaned = value
    .toString()
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30)
    const serialDate = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(serialDate.getTime()) ? null : serialDate;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeRow = (row) => {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    normalized[normalizeColumnName(key)] = value;
  }
  return normalized;
};

const normalizeSourceType = (value) => {
  const normalized = value?.toString().trim().toUpperCase();
  if (normalized === "REUTILIZAR_CICLO") return "REUSE_BASE";
  return normalized;
};

const resolveOrSyncLocalUserBySam = async (samAccountName) => {
  const normalizedSam = samAccountName?.toString().trim();
  if (!normalizedSam) return null;

  const user = await prisma.user.findUnique({
    where: { samAccountName: normalizedSam },
  });

  if (user) {
    return user;
  }

  const directoryUser = await findDirectoryUserBySam(normalizedSam);
  if (!directoryUser) {
    return null;
  }

  const resolvedSam =
    directoryUser.sAMAccountName ||
    directoryUser.samAccountName ||
    normalizedSam;
  const resolvedFullName = directoryUser.fullName || resolvedSam;

  return prisma.user.create({
    data: {
      samAccountName: resolvedSam,
      fullName: resolvedFullName,
      role: "CONFERENTE",
    },
  });
};

const canUserCreateInventory = async (user) => {
  if (!user) return false;
  if (user.role === "ADMIN") return true;

  const adminCycleLink = await prisma.inventoryUser.findFirst({
    where: {
      userId: user.id,
      role: "ADMIN_CICLO",
    },
    select: { id: true },
  });

  return Boolean(adminCycleLink);
};

const ensureInventoryAuditLogTable = async (db) => {
  await db.$executeRaw`
    CREATE TABLE IF NOT EXISTS inventory_audit_log (
      id TEXT PRIMARY KEY,
      inventoryId TEXT NOT NULL,
      action TEXT NOT NULL,
      field TEXT,
      fromValue TEXT,
      toValue TEXT,
      metadata TEXT,
      changedBy TEXT NOT NULL,
      changedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await db.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_inventory_audit_log_inventory_changedAt
    ON inventory_audit_log (inventoryId, changedAt DESC)
  `;
};

const recordInventoryAudit = async (db, entry) => {
  await ensureInventoryAuditLogTable(db);

  await db.$executeRaw`
    INSERT INTO inventory_audit_log
    (id, inventoryId, action, field, fromValue, toValue, metadata, changedBy, changedAt)
    VALUES
    (${randomUUID()}, ${entry.inventoryId}, ${entry.action}, ${entry.field || null}, ${entry.fromValue || null}, ${entry.toValue || null}, ${entry.metadata || null}, ${entry.changedBy}, ${new Date()})
  `;
};

const worksheetToObjects = (worksheet) => {
  const rows = [];
  const headerRow = worksheet.getRow(1);
  const headers = [];

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cell.value?.toString().trim() || "";
  });

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const rowData = {};
    let hasAnyValue = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const cellValue = row.getCell(index + 1).value;
      const value =
        typeof cellValue === "object" && cellValue !== null
          ? cellValue.text || cellValue.result || null
          : cellValue;
      if (value !== null && value !== undefined && value !== "") {
        hasAnyValue = true;
      }
      rowData[header] = value ?? null;
    });

    if (hasAnyValue) {
      rows.push(rowData);
    }
  }

  return rows;
};

const parseInventoryWorkbook = async (buffer) => {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets?.[0];
    const sheetName = worksheet?.name;

    if (!worksheet || !sheetName) {
      return { valid: false, error: "Arquivo XLSX sem abas válidas" };
    }

    const rows = worksheetToObjects(worksheet);

    if (!rows || rows.length === 0) {
      return { valid: false, error: "Planilha sem linhas de dados" };
    }

    const firstRow = rows[0] || {};
    const headers = Object.keys(firstRow).map((h) => normalizeColumnName(h));

    const missingColumns = XLSX_REQUIRED_COLUMNS.filter(
      (column) => !headers.includes(column),
    );
    if (missingColumns.length > 0) {
      return {
        valid: false,
        error: `Colunas obrigatórias ausentes: ${missingColumns.join(", ")}`,
      };
    }

    const hasRoomColumn = XLSX_ROOM_COLUMNS.some((column) =>
      headers.includes(column),
    );
    if (!hasRoomColumn) {
      return {
        valid: false,
        error:
          "Planilha deve conter ao menos uma coluna de local (você digita a sala ou setor)",
      };
    }

    return {
      valid: true,
      sourceFormat: "XLSX",
      sheetName,
      rowCount: rows.length,
      headers,
      rows,
    };
  } catch (error) {
    return { valid: false, error: "Arquivo XLSX inválido ou corrompido" };
  }
};

const createImportSummary = ({ sourceFormat, totalRowsRead }) => ({
  sourceFormat,
  totalRowsRead,
  totalItemsRegistered: 0,
  totalItemsSkipped: 0,
  locationTotalsKnown: {},
  unknownLocationCount: 0,
  failures: [],
  parseDiagnostics: null,
});

const pushImportFailure = (summary, failure) => {
  if (!summary || summary.failures.length >= MAX_IMPORT_FAILURE_SAMPLES) return;
  summary.failures.push(failure);
};

const parseInventoryPdf = async (buffer) => {
  const parser = new PDFParse({ data: buffer });

  try {
    const parsed = await parser.getText();
    const text = repairMojibake(parsed?.text?.toString() || "");

    if (!text.trim()) {
      return { valid: false, error: "Arquivo PDF sem texto legível" };
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const rows = [];
    const normalizedLines = lines.map((line) => normalizeColumnName(line));
    const hasHeader = normalizedLines.some((line) =>
      PDF_HEADER_PATTERN.test(line),
    );
    const parseDiagnostics = {
      totalInputLines: lines.length,
      candidateRowLines: 0,
      parsedRowLines: 0,
      skippedCandidateLines: 0,
      skippedCandidateSamples: [],
      detectedHeader: hasHeader,
    };

    const hasLetters = (value) => /[a-zA-Z]/.test(value);
    const hasDigits = (value) => /\d/.test(value);
    const isCandidateRowLine = (line) => /^\d{6,}\s+\d+\s+/.test(line);
    const trackSkippedCandidate = (line, reason) => {
      parseDiagnostics.skippedCandidateLines += 1;
      if (parseDiagnostics.skippedCandidateSamples.length < 10) {
        parseDiagnostics.skippedCandidateSamples.push({ reason, line });
      }
    };

    for (const line of lines) {
      if (
        PDF_HEADER_PATTERN.test(line) ||
        /^pagina\s+\d+\s+de\s+\d+/i.test(line) ||
        /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) ||
        /^total\s+parcial/i.test(line)
      ) {
        continue;
      }

      if (isCandidateRowLine(line)) {
        parseDiagnostics.candidateRowLines += 1;
      }

      const match = line.match(PDF_ROW_PATTERN);
      if (!match) {
        if (isCandidateRowLine(line)) {
          trackSkippedCandidate(
            line,
            "Formato não reconhecido para linha de item",
          );
        }
        continue;
      }

      const trailingTokens = match[5]
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);

      if (trailingTokens.length < 2 || trailingTokens.length > 3) {
        trackSkippedCandidate(
          line,
          "Colunas intermediárias inesperadas entre aquisição e valor",
        );
        continue;
      }

      const empenho = trailingTokens[trailingTokens.length - 1] || null;
      let notaFis = null;
      let cons = null;

      if (trailingTokens.length === 2) {
        if (hasLetters(trailingTokens[0]) && !hasDigits(trailingTokens[0])) {
          cons = trailingTokens[0];
        } else {
          notaFis = trailingTokens[0];
        }
      } else {
        const first = trailingTokens[0];
        const second = trailingTokens[1];

        if (hasLetters(first) && !hasLetters(second)) {
          cons = first;
          notaFis = second;
        } else if (!hasLetters(first) && hasLetters(second)) {
          notaFis = first;
          cons = second;
        } else {
          cons = first;
          notaFis = second;
        }
      }

      rows.push({
        class: match[1],
        patrimonio: match[2],
        descricao: repairMojibake(match[3]),
        aquisicao: match[4],
        "nota fis": notaFis,
        cons,
        empenho,
        valor: match[6],
        seq: match[7],
        localizacao: repairMojibake(match[8]),
      });

      parseDiagnostics.parsedRowLines += 1;
    }

    if (rows.length === 0) {
      return {
        valid: false,
        error:
          "Não foi possível extrair linhas do PDF. Verifique se o arquivo segue o layout do inventário patrimonial e se possui texto legível.",
      };
    }

    const headers = Object.keys(rows[0] || {}).map((h) =>
      normalizeColumnName(h),
    );
    const missingColumns = PDF_REQUIRED_COLUMNS.filter(
      (column) => !headers.includes(column),
    );
    if (missingColumns.length > 0) {
      return {
        valid: false,
        error: `Colunas obrigatórias ausentes no PDF: ${missingColumns.join(", ")}`,
      };
    }

    return {
      valid: true,
      sourceFormat: "PDF",
      rowCount: rows.length,
      headers,
      rows,
      parseDiagnostics,
    };
  } catch {
    return { valid: false, error: "Arquivo PDF inválido ou corrompido" };
  } finally {
    await parser.destroy();
  }
};

const isPdfUpload = (file) => {
  const mime = file?.mimetype?.toLowerCase() || "";
  const name = file?.originalname?.toLowerCase() || "";
  return mime.includes("pdf") || name.endsWith(".pdf");
};

const canTransitionStatus = (fromStatus, toStatus) => {
  if (fromStatus === toStatus) return true;
  return STATUS_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
};

const normalizePersonText = (value) =>
  value
    ?.toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeDigits = (value) => value?.toString().replace(/\D/g, "") || "";

const COMMISSION_ROLE_PREFIX_PATTERN =
  /^(?:\s*[IVXLC]+\s*[–.-]\s*)?(?:presidente(?:\s+da\s+comiss[aã]o)?|presidenta(?:\s+da\s+comiss[aã]o)?|respons[aá]vel(?:\s+pela\s+comiss[aã]o)?|coordenador(?:a)?(?:\s+da\s+comiss[aã]o)?)(?:\s*[:\-–,]\s*|\s+)+/i;

const COMMISSION_ROLE_MARKER_PATTERN =
  /\b(presidente|presidenta|respons[aá]vel|coordenador|coordenadora)\b/i;

const stripCommissionRolePrefix = (value) =>
  value?.toString().replace(COMMISSION_ROLE_PREFIX_PATTERN, "").trim();

const extractCommissionNames = (rawText) => {
  const text = rawText?.toString() || "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const members = [];
  let explicitResponsible = null;
  for (const line of lines) {
    if (!/matr[ií]cula/i.test(line)) continue;

    const beforeMatricula = line
      .split(/matr[ií]cula/i)[0]
      .replace(/[,:;\-–]\s*$/, "")
      .replace(/^\s*[IVXLC]+\s*[–.-]\s*/i, "")
      .trim();

    const cleanedName = stripCommissionRolePrefix(beforeMatricula)
      .replace(/\s+/g, " ")
      .trim();
    const siapeMatch = line.match(/matr[ií]cula(?:\s+SIAPE)?\s+([0-9.\-/]+)/i);
    const siape = normalizeDigits(siapeMatch?.[1]);
    const hasExplicitRole = COMMISSION_ROLE_MARKER_PATTERN.test(line);

    const tokenCount = cleanedName.split(" ").filter(Boolean).length;
    if (tokenCount < 2) continue;
    if (
      /^(art\.|portaria|ministerio|instituto|campus|resolve)/i.test(cleanedName)
    ) {
      continue;
    }

    const member = { fullName: cleanedName, siape };
    members.push(member);

    if (hasExplicitRole && !explicitResponsible) {
      explicitResponsible = member;
    }
  }

  const uniqueMembers = [];
  const seenSiapes = new Set();
  for (const member of members) {
    if (!member.siape || seenSiapes.has(member.siape)) continue;
    seenSiapes.add(member.siape);
    uniqueMembers.push(member);
  }

  const responsibleMember = explicitResponsible || uniqueMembers[0] || null;
  const presidentName = responsibleMember?.fullName || null;
  const memberNames = uniqueMembers.slice(1).map((member) => member.fullName);

  return {
    presidentName,
    responsibleMember,
    memberNames,
    members: uniqueMembers,
  };
};

const resolveCommissionMemberBySiape = async ({ fullName, siape }) => {
  const normalizedSiape = normalizeDigits(siape);
  if (!normalizedSiape) return null;

  const directoryUser =
    await findUniqueDirectoryUserByEmployeeID(normalizedSiape);
  if (!directoryUser) {
    return null;
  }

  let localUser = await prisma.user.findUnique({
    where: { samAccountName: directoryUser.sAMAccountName },
  });

  if (!localUser) {
    localUser = await prisma.user.findFirst({
      where: {
        OR: [
          { samAccountName: normalizedSiape },
          { fullName: { contains: fullName } },
        ],
      },
      orderBy: { fullName: "asc" },
    });
  }

  if (!localUser) {
    localUser = await prisma.user.create({
      data: {
        samAccountName: directoryUser.sAMAccountName,
        fullName: directoryUser.fullName || fullName,
        role: "CONFERENTE",
      },
    });

    return {
      user: localUser,
      createdFromDirectory: true,
      siape: normalizedSiape,
    };
  }

  const resolvedFullName =
    directoryUser.fullName || fullName || localUser.fullName;
  if (resolvedFullName && localUser.fullName !== resolvedFullName) {
    localUser = await prisma.user.update({
      where: { id: localUser.id },
      data: { fullName: resolvedFullName },
    });
  }

  return {
    user: localUser,
    createdFromDirectory: false,
    siape: normalizedSiape,
  };
};

const resolvePersonByNameOrSam = async (identifier) => {
  const term = identifier?.toString().trim();
  if (!term) return null;

  const localUser = await prisma.user.findFirst({
    where: {
      OR: [
        { samAccountName: { contains: term } },
        { fullName: { contains: term } },
      ],
    },
    orderBy: { fullName: "asc" },
  });

  if (localUser) {
    return {
      user: localUser,
      createdFromDirectory: false,
    };
  }

  const directoryCandidates = await searchDirectoryUsers(term, 10);
  let directoryUser = null;

  if (directoryCandidates.length > 0) {
    const normalizedTerm = normalizePersonText(term);
    const termTokens = normalizedTerm
      .split(" ")
      .filter((token) => token.length >= 2);

    directoryUser =
      directoryCandidates.find((candidate) => {
        const normalizedFullName = normalizePersonText(candidate.fullName);
        return normalizedFullName && normalizedFullName === normalizedTerm;
      }) ||
      directoryCandidates.find((candidate) => {
        const normalizedFullName = normalizePersonText(candidate.fullName);
        if (!normalizedFullName) return false;
        return termTokens.every((token) => normalizedFullName.includes(token));
      }) ||
      directoryCandidates[0];
  }

  if (!directoryUser) {
    return null;
  }

  const resolvedSam = directoryUser.sAMAccountName;
  if (!resolvedSam) {
    return null;
  }

  const existingByResolvedSam = await prisma.user.findUnique({
    where: { samAccountName: resolvedSam },
  });

  if (existingByResolvedSam) {
    return {
      user: existingByResolvedSam,
      createdFromDirectory: false,
    };
  }

  const createdLocalUser = await prisma.user.create({
    data: {
      samAccountName: resolvedSam,
      fullName: directoryUser.fullName || resolvedSam,
      role: "CONFERENTE",
    },
  });

  return {
    user: createdLocalUser,
    createdFromDirectory: true,
  };
};

router.get("/my", verifyJWT, async (req, res) => {
  try {
    const user = await findUserBySamAccountName(req.user?.sub);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    await ensureInventoryBootstrapForUser(user);

    if (user.role === "ADMIN") {
      const inventories = await prisma.inventory.findMany({
        include: {
          _count: {
            select: {
              spaces: true,
              items: true,
              users: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return res.json(
        inventories.map((inventory) => ({
          id: inventory.id,
          name: inventory.name,
          campus: inventory.campus,
          statusOperacao: inventory.statusOperacao,
          sourceType: inventory.sourceType,
          createdAt: inventory.createdAt,
          role: "ADMIN_CICLO",
          counts: {
            spaces: inventory._count.spaces,
            items: inventory._count.items,
            users: inventory._count.users,
          },
        })),
      );
    }

    const memberships = await prisma.inventoryUser.findMany({
      where: { userId: user.id },
      include: {
        inventory: {
          include: {
            _count: {
              select: {
                spaces: true,
                items: true,
                users: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(
      memberships.map((membership) => ({
        id: membership.inventory.id,
        name: membership.inventory.name,
        campus: membership.inventory.campus,
        statusOperacao: membership.inventory.statusOperacao,
        sourceType: membership.inventory.sourceType,
        createdAt: membership.inventory.createdAt,
        role: membership.role,
        counts: {
          spaces: membership.inventory._count.spaces,
          items: membership.inventory._count.items,
          users: membership.inventory._count.users,
        },
      })),
    );
  } catch (error) {
    console.error("Error listing user inventories:", error);
    return res.status(500).json({ error: "Erro ao carregar inventários" });
  }
});

router.get("/users/search", verifyJWT, async (req, res) => {
  try {
    const requestUser = await findUserBySamAccountName(req.user?.sub);
    if (!requestUser) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    await ensureInventoryBootstrapForUser(requestUser);

    const canCreate = await canUserCreateInventory(requestUser);
    if (!canCreate) {
      return res
        .status(403)
        .json({ error: "Usuário sem permissão para buscar servidores" });
    }

    const q = req.query.q?.toString().trim();
    if (!q || q.length < 2) {
      return res
        .status(400)
        .json({ error: "Informe ao menos 2 caracteres para busca" });
    }

    const localUsers = await prisma.user.findMany({
      where: {
        OR: [
          { samAccountName: { contains: q } },
          { fullName: { contains: q } },
        ],
      },
      orderBy: { fullName: "asc" },
      take: 5,
    });

    if (localUsers.length > 0) {
      return res.json({
        source: "LOCAL",
        users: localUsers.map((user) => ({
          userId: user.id,
          samAccountName: user.samAccountName,
          fullName: user.fullName,
          existsLocally: true,
        })),
      });
    }

    const directoryUsers = await searchDirectoryUsers(q, 5);

    return res.json({
      source: "DIRECTORY",
      users: directoryUsers.slice(0, 5).map((user) => ({
        userId: null,
        samAccountName: user.sAMAccountName,
        fullName: user.fullName || user.sAMAccountName,
        existsLocally: false,
      })),
    });
  } catch (error) {
    console.error("Error searching users for inventory creation:", error);
    return res.status(500).json({ error: "Erro ao buscar usuários" });
  }
});

router.post(
  "/commission/parse",
  verifyJWT,
  upload.single("commissionPdf"),
  async (req, res) => {
    try {
      const requestUser = await findUserBySamAccountName(req.user?.sub);
      if (!requestUser) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      await ensureInventoryBootstrapForUser(requestUser);

      const canCreate = await canUserCreateInventory(requestUser);
      if (!canCreate) {
        return res.status(403).json({
          error: "Usuário sem permissão para processar portaria de comissão",
        });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          error: "Arquivo PDF da portaria é obrigatório",
        });
      }

      const parser = new PDFParse({ data: req.file.buffer });
      const parsed = await parser.getText();
      await parser.destroy();

      const extracted = extractCommissionNames(parsed.text || "");

      if (!extracted.members?.length) {
        return res.status(400).json({
          error:
            "Não foi possível identificar nomes na portaria. Verifique o arquivo e tente novamente.",
        });
      }

      let owner = null;
      const members = [];
      const unresolvedNames = [];

      const responsibleSource =
        extracted.responsibleMember || extracted.members[0];
      const resolvedOwner = responsibleSource
        ? await resolveCommissionMemberBySiape(responsibleSource)
        : null;

      if (resolvedOwner?.user) {
        owner = {
          userId: resolvedOwner.user.id,
          samAccountName: resolvedOwner.user.samAccountName,
          fullName: resolvedOwner.user.fullName,
          existsLocally: !resolvedOwner.createdFromDirectory,
          siape: resolvedOwner.siape,
        };
      } else {
        if (responsibleSource) {
          unresolvedNames.push(
            `${responsibleSource.fullName} (${responsibleSource.siape})`,
          );
        }
      }

      for (const memberEntry of extracted.members.slice(1)) {
        const resolvedMember =
          await resolveCommissionMemberBySiape(memberEntry);
        if (!resolvedMember?.user) {
          unresolvedNames.push(
            `${memberEntry.fullName} (${memberEntry.siape})`,
          );
          continue;
        }

        if (
          owner &&
          resolvedMember.user.samAccountName.toLowerCase() ===
            owner.samAccountName.toLowerCase()
        ) {
          continue;
        }

        if (
          members.some(
            (member) =>
              member.samAccountName.toLowerCase() ===
              resolvedMember.user.samAccountName.toLowerCase(),
          )
        ) {
          continue;
        }

        members.push({
          userId: resolvedMember.user.id,
          samAccountName: resolvedMember.user.samAccountName,
          fullName: resolvedMember.user.fullName,
          existsLocally: !resolvedMember.createdFromDirectory,
          siape: resolvedMember.siape,
          role: "CONFERENTE",
        });
      }

      return res.json({
        success: true,
        owner,
        members,
        unresolvedNames,
        extractedMembers: extracted.members,
      });
    } catch (error) {
      console.error("Error parsing commission ordinance PDF:", error);
      return res
        .status(500)
        .json({ error: "Erro ao processar a portaria da comissão" });
    }
  },
);

router.post("/", verifyJWT, upload.single("xlsxFile"), async (req, res) => {
  try {
    const requestUser = await findUserBySamAccountName(req.user?.sub);
    if (!requestUser) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    await ensureInventoryBootstrapForUser(requestUser);

    const canCreate = await canUserCreateInventory(requestUser);
    if (!canCreate) {
      return res
        .status(403)
        .json({ error: "Usuário sem permissão para criar inventários" });
    }

    const name = req.body?.name?.toString().trim();
    const campus = req.body?.campus?.toString().trim() || "Campus Aracruz";
    const sourceType = normalizeSourceType(req.body?.dataSource);
    const baseInventoryId =
      req.body?.baseInventoryId?.toString().trim() || null;
    const ownerUserId = req.body?.ownerUserId?.toString().trim() || null;
    const ownerSamAccountName = req.body?.ownerSamAccountName
      ?.toString()
      .trim();
    const startDateRaw = req.body?.startDate?.toString().trim();
    const endDateRaw = req.body?.endDate?.toString().trim();
    const initialMembers = (() => {
      if (Array.isArray(req.body?.initialMembers))
        return req.body.initialMembers;

      if (typeof req.body?.initialMembers === "string") {
        try {
          const parsed = JSON.parse(req.body.initialMembers);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }

      return [];
    })();

    if (!name) {
      return res
        .status(400)
        .json({ error: "Nome do inventário é obrigatório" });
    }

    if (!sourceType || !INVENTORY_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({
        error: "Fonte de dados inválida. Use UPLOAD_XLSX ou REUSE_BASE",
      });
    }

    if (!startDateRaw) {
      return res.status(400).json({ error: "Data de início é obrigatória" });
    }

    const startDate = new Date(startDateRaw);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Data de início inválida" });
    }

    const endDate = endDateRaw ? new Date(endDateRaw) : null;
    if (endDateRaw && Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Data de término inválida" });
    }

    if (endDate && endDate < startDate) {
      return res.status(400).json({
        error: "Data de término não pode ser anterior à data de início",
      });
    }

    if (sourceType === "REUSE_BASE" && !baseInventoryId) {
      return res.status(400).json({
        error: "baseInventoryId é obrigatório quando a fonte é REUSE_BASE",
      });
    }

    let uploadValidation = null;
    if (sourceType === "UPLOAD_XLSX") {
      if (!req.file?.buffer) {
        return res.status(400).json({
          error:
            "Arquivo XLSX ou PDF é obrigatório quando a fonte de dados é UPLOAD_XLSX",
        });
      }

      uploadValidation = isPdfUpload(req.file)
        ? await parseInventoryPdf(req.file.buffer)
        : await parseInventoryWorkbook(req.file.buffer);
      if (!uploadValidation.valid) {
        return res.status(400).json({
          error: uploadValidation.error,
        });
      }
    }

    let baseInventory = null;
    if (baseInventoryId) {
      baseInventory = await prisma.inventory.findUnique({
        where: { id: baseInventoryId },
      });

      if (!baseInventory) {
        return res
          .status(404)
          .json({ error: "Inventário base não encontrado" });
      }

      if (
        sourceType === "REUSE_BASE" &&
        baseInventory.statusOperacao !== "FINALIZADO"
      ) {
        return res.status(409).json({
          error: "Somente inventários finalizados podem ser reutilizados",
        });
      }
    }

    let ownerUser = requestUser;
    if (ownerUserId) {
      ownerUser = await prisma.user.findUnique({ where: { id: ownerUserId } });
      if (!ownerUser) {
        return res.status(404).json({ error: "Responsável não encontrado" });
      }
    } else if (ownerSamAccountName) {
      ownerUser = await resolveOrSyncLocalUserBySam(ownerSamAccountName);

      if (!ownerUser) {
        return res.status(404).json({
          error: "Responsável não encontrado no banco local nem no AD.",
        });
      }
    }

    const sanitizedMembers = [];
    for (const rawMember of initialMembers) {
      const role = rawMember?.role?.toString().trim();
      const memberUserId = rawMember?.userId?.toString().trim();
      const memberSam = rawMember?.samAccountName?.toString().trim();

      if (!role || !isValidInventoryRole(role)) {
        return res
          .status(400)
          .json({ error: "Perfil inválido em usuários adicionais" });
      }

      let memberUser = null;
      if (memberUserId) {
        memberUser = await prisma.user.findUnique({
          where: { id: memberUserId },
        });
      }

      if (!memberUser && memberSam) {
        memberUser = await resolveOrSyncLocalUserBySam(memberSam);
      }

      if (!memberUser) {
        return res.status(404).json({
          error: "Usuário adicional não encontrado no banco local nem no AD.",
        });
      }

      sanitizedMembers.push({
        userId: memberUser.id,
        role,
      });
    }

    let importSummary = null;

    const newInventory = await prisma.$transaction(
      async (tx) => {
        const createdInventory = await tx.inventory.create({
          data: {
            name,
            campus,
            sourceType,
            statusOperacao: "NAO_INICIADO",
            baseInventoryId:
              sourceType === "REUSE_BASE" ? baseInventoryId : null,
            createdById: ownerUser.id,
            startedAt: startDate,
            finishedAt: endDate,
          },
        });

        const membershipMap = new Map();
        membershipMap.set(requestUser.id, "ADMIN_CICLO");
        membershipMap.set(
          ownerUser.id,
          membershipMap.get(ownerUser.id) || "ADMIN_CICLO",
        );

        for (const member of sanitizedMembers) {
          if (!membershipMap.has(member.userId)) {
            membershipMap.set(member.userId, member.role);
          }
        }

        const membershipPayload = Array.from(membershipMap.entries()).map(
          ([userId, role]) => ({
            inventoryId: createdInventory.id,
            userId,
            role,
          }),
        );

        if (membershipPayload.length > 0) {
          await tx.inventoryUser.createMany({ data: membershipPayload });
        }

        if (sourceType === "REUSE_BASE" && baseInventoryId) {
          const baseSpaces = await tx.space.findMany({
            where: { inventoryId: baseInventoryId },
          });

          const spaceIdMap = new Map();

          for (const baseSpace of baseSpaces) {
            const newSpaceId = randomUUID();
            spaceIdMap.set(baseSpace.id, newSpaceId);

            await tx.space.create({
              data: {
                id: newSpaceId,
                name: baseSpace.name,
                responsible: baseSpace.responsible,
                sector: baseSpace.sector,
                unit: baseSpace.unit,
                inventoryId: createdInventory.id,
                isActive: baseSpace.isActive,
                isFinalized: false,
              },
            });
          }

          const baseItems = await tx.item.findMany({
            where: { inventoryId: baseInventoryId },
          });

          const baseItemPayload = [];
          for (const baseItem of baseItems) {
            const mappedSpaceId = spaceIdMap.get(baseItem.spaceId);
            if (!mappedSpaceId) {
              continue;
            }

            baseItemPayload.push({
              id: randomUUID(),
              patrimonio: baseItem.patrimonio,
              descricao: baseItem.descricao,
              valor: baseItem.valor,
              condicaoOriginal: baseItem.condicaoOriginal,
              fornecedor: baseItem.fornecedor,
              cnpjFornecedor: baseItem.cnpjFornecedor,
              catalogo: baseItem.catalogo,
              codigoSIA: baseItem.codigoSIA,
              descricaoSIA: baseItem.descricaoSIA,
              numeroEntrada: baseItem.numeroEntrada,
              dataEntrada: baseItem.dataEntrada,
              dataAquisicao: baseItem.dataAquisicao,
              documento: baseItem.documento,
              dataDocumento: baseItem.dataDocumento,
              tipoAquisicao: baseItem.tipoAquisicao,
              inventoryId: createdInventory.id,
              spaceId: mappedSpaceId,
              lastKnownSpaceId: baseItem.lastKnownSpaceId
                ? spaceIdMap.get(baseItem.lastKnownSpaceId) || null
                : null,
              statusEncontrado: "PENDENTE",
              condicaoVisual: null,
              dataConferencia: null,
              ultimoConferente: null,
            });
          }

          if (baseItemPayload.length > 0) {
            await tx.item.createMany({ data: baseItemPayload });
          }
        }

        if (
          sourceType === "UPLOAD_XLSX" &&
          uploadValidation?.rows?.length > 0
        ) {
          const xlsxRows = uploadValidation.rows.map((row) =>
            normalizeRow(row),
          );

          importSummary = createImportSummary({
            sourceFormat: uploadValidation.sourceFormat || "XLSX",
            totalRowsRead: xlsxRows.length,
          });

          if (uploadValidation.parseDiagnostics) {
            importSummary.parseDiagnostics = uploadValidation.parseDiagnostics;

            if (!uploadValidation.parseDiagnostics.detectedHeader) {
              pushImportFailure(importSummary, {
                type: "PDF_HEADER_NOT_DETECTED",
                message:
                  "Cabeçalho do PDF não foi identificado com confiança; leitura continuou por detecção de linhas de item.",
              });
            }

            if (uploadValidation.parseDiagnostics.skippedCandidateLines > 0) {
              pushImportFailure(importSummary, {
                type: "PDF_PARSE_WARNING",
                message: `Foram ignoradas ${uploadValidation.parseDiagnostics.skippedCandidateLines} linhas candidatas durante a leitura do PDF`,
                samples:
                  uploadValidation.parseDiagnostics.skippedCandidateSamples,
              });
            }
          }

          const spacesByKey = new Map();
          for (const row of xlsxRows) {
            const roomName =
              toTextOrNull(row["voce digita a sala"]) ||
              toTextOrNull(row.localizacao) ||
              toTextOrNull(row.setor) ||
              UNKNOWN_LOCATION_KEY;

            const spaceKey = roomName.toLowerCase();
            const previous = spacesByKey.get(spaceKey);

            if (!previous) {
              spacesByKey.set(spaceKey, {
                name: roomName,
                responsible: toTextOrNull(row.responsavel) || "Não informado",
                sector: toTextOrNull(row.setor),
                unit: toTextOrNull(row.unidade),
              });
              continue;
            }

            if (previous.responsible === "Não informado") {
              previous.responsible =
                toTextOrNull(row.responsavel) || previous.responsible;
            }

            if (!previous.sector) {
              previous.sector = toTextOrNull(row.setor);
            }

            if (!previous.unit) {
              previous.unit = toTextOrNull(row.unidade);
            }
          }

          const spaceIdMap = new Map();
          for (const [spaceKey, spaceData] of spacesByKey.entries()) {
            const createdSpace = await tx.space.create({
              data: {
                id: randomUUID(),
                name: spaceData.name,
                responsible: spaceData.responsible,
                sector: spaceData.sector,
                unit: spaceData.unit,
                inventoryId: createdInventory.id,
                isActive: true,
                isFinalized: false,
              },
            });

            spaceIdMap.set(spaceKey, createdSpace.id);
          }

          const seenPatrimonios = new Set();
          const itemPayload = [];
          for (const [rowIndex, row] of xlsxRows.entries()) {
            const rowReference =
              Number.parseInt(toTextOrNull(row.seq) || "", 10) || rowIndex + 1;

            const patrimonio = toTextOrNull(row.patrimonio);
            if (!patrimonio) {
              pushImportFailure(importSummary, {
                type: "MISSING_PATRIMONIO",
                row: rowReference,
                message: "Linha ignorada por patrimônio ausente",
              });
              continue;
            }

            if (seenPatrimonios.has(patrimonio)) {
              pushImportFailure(importSummary, {
                type: "DUPLICATE_PATRIMONIO",
                row: rowReference,
                patrimonio,
                message: "Linha ignorada por patrimônio duplicado",
              });
              continue;
            }

            seenPatrimonios.add(patrimonio);

            const roomName =
              toTextOrNull(row["voce digita a sala"]) ||
              toTextOrNull(row.localizacao) ||
              toTextOrNull(row.setor) ||
              UNKNOWN_LOCATION_KEY;
            const spaceId = spaceIdMap.get(roomName.toLowerCase());
            if (!spaceId) {
              pushImportFailure(importSummary, {
                type: "SPACE_NOT_CREATED",
                row: rowReference,
                patrimonio,
                location: roomName,
                message:
                  "Linha ignorada porque não foi possível mapear a localização",
              });
              continue;
            }

            const foundRaw = toTextOrNull(row.encontrado)?.toLowerCase();
            const statusEncontrado =
              foundRaw === "sim"
                ? "SIM"
                : foundRaw === "nao"
                  ? "NAO"
                  : "PENDENTE";

            itemPayload.push({
              id: randomUUID(),
              patrimonio,
              descricao: toTextOrNull(row.descricao) || "Sem descrição",
              valor: parseCurrency(row.valor),
              condicaoOriginal:
                toTextOrNull(row.condicao) ||
                toTextOrNull(row["(estado)"]) ||
                toTextOrNull(row.cons) ||
                "Não informado",
              fornecedor: toTextOrNull(row.fornecedor),
              cnpjFornecedor: toTextOrNull(row.cnpj_fornecedor),
              catalogo: toTextOrNull(row.catalogo),
              codigoSIA:
                toTextOrNull(row.codigo_sia) || toTextOrNull(row.class),
              descricaoSIA: toTextOrNull(row.descricao_sia),
              numeroEntrada:
                toTextOrNull(row.numero_entrada) || toTextOrNull(row.empenho),
              dataEntrada: parseDate(row.data_entrada),
              dataAquisicao:
                parseDate(row.data_aquisicao) || parseDate(row.aquisicao),
              documento:
                toTextOrNull(row.documento) || toTextOrNull(row["nota fis"]),
              dataDocumento: parseDate(row.data_documento),
              tipoAquisicao: toTextOrNull(row.tipo_aquisicao),
              inventoryId: createdInventory.id,
              spaceId,
              lastKnownSpaceId: null,
              statusEncontrado,
              condicaoVisual: null,
              dataConferencia: null,
              ultimoConferente: null,
            });

            importSummary.totalItemsRegistered += 1;
            if (roomName === UNKNOWN_LOCATION_KEY) {
              importSummary.unknownLocationCount += 1;
            } else {
              importSummary.locationTotalsKnown[roomName] =
                (importSummary.locationTotalsKnown[roomName] || 0) + 1;
            }
          }

          importSummary.totalItemsSkipped =
            importSummary.totalRowsRead - importSummary.totalItemsRegistered;

          if (itemPayload.length > 0) {
            await tx.item.createMany({ data: itemPayload });
          }
        }

        await recordInventoryAudit(tx, {
          inventoryId: createdInventory.id,
          action: "INVENTORY_CREATED",
          field: null,
          fromValue: null,
          toValue: createdInventory.name,
          metadata: JSON.stringify({
            sourceType,
            ownerSamAccountName: ownerUser.samAccountName,
            memberCount: membershipPayload.length,
            xlsx: uploadValidation
              ? {
                  rowCount: uploadValidation.rowCount,
                  sheetName: uploadValidation.sheetName,
                  sourceFormat: uploadValidation.sourceFormat || "XLSX",
                  importSummary: importSummary
                    ? {
                        totalRowsRead: importSummary.totalRowsRead,
                        totalItemsRegistered:
                          importSummary.totalItemsRegistered,
                        totalItemsSkipped: importSummary.totalItemsSkipped,
                        unknownLocationCount:
                          importSummary.unknownLocationCount,
                        knownLocations: Object.keys(
                          importSummary.locationTotalsKnown,
                        ).length,
                        failureCount: importSummary.failures.length,
                      }
                    : null,
                }
              : null,
          }),
          changedBy: req.user?.sub || "unknown",
        });

        return createdInventory;
      },
      { maxWait: 10000, timeout: 120000 },
    );

    return res.status(201).json({
      success: true,
      inventory: {
        id: newInventory.id,
        name: newInventory.name,
        campus: newInventory.campus,
        sourceType: newInventory.sourceType,
        statusOperacao: newInventory.statusOperacao,
        startedAt: newInventory.startedAt,
        finishedAt: newInventory.finishedAt,
      },
      importSummary,
    });
  } catch (error) {
    console.error("Error creating inventory:", error);
    return res.status(500).json({ error: "Erro ao criar inventário" });
  }
});

router.get(
  "/:inventoryId/status-history",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const historyDelegate = prisma.inventoryStatusHistory;

      const history = historyDelegate
        ? await historyDelegate.findMany({
            where: { inventoryId: req.inventoryId },
            orderBy: { changedAt: "desc" },
          })
        : await prisma.$queryRaw`
            SELECT id, fromStatus, toStatus, changedBy, changedAt
            FROM inventory_status_history
            WHERE inventoryId = ${req.inventoryId}
            ORDER BY changedAt DESC
          `;

      return res.json(
        history.map((entry) => ({
          id: entry.id,
          fromStatus: entry.fromStatus,
          toStatus: entry.toStatus,
          changedBy: entry.changedBy,
          changedAt: entry.changedAt,
        })),
      );
    } catch (error) {
      console.error("Error listing inventory status history:", error);
      return res.status(500).json({ error: "Erro ao carregar histórico" });
    }
  },
);

router.patch(
  "/:inventoryId",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const requestedName = req.body?.name?.toString().trim();
      const requestedStatus = req.body?.statusOperacao?.toString().trim();

      if (!requestedName && !requestedStatus) {
        return res.status(400).json({
          error:
            "Informe ao menos um campo para atualização (name/statusOperacao)",
        });
      }

      if (requestedStatus && !isValidInventoryStatus(requestedStatus)) {
        return res.status(400).json({ error: "Status operacional inválido" });
      }

      const inventory = await prisma.inventory.findUnique({
        where: { id: req.inventoryId },
      });

      if (!inventory) {
        return res.status(404).json({ error: "Inventário não encontrado" });
      }

      if (
        requestedStatus &&
        !canTransitionStatus(inventory.statusOperacao, requestedStatus)
      ) {
        return res.status(409).json({
          error: `Transição inválida de ${inventory.statusOperacao} para ${requestedStatus}`,
        });
      }

      const now = new Date();
      const willChangeStatus =
        Boolean(requestedStatus) &&
        requestedStatus !== inventory.statusOperacao;

      const updateData = {};
      if (requestedName) {
        updateData.name = requestedName;
      }
      if (requestedStatus) {
        updateData.statusOperacao = requestedStatus;
      }
      if (
        willChangeStatus &&
        !inventory.startedAt &&
        requestedStatus !== "NAO_INICIADO"
      ) {
        updateData.startedAt = now;
      }
      if (willChangeStatus && requestedStatus === "FINALIZADO") {
        updateData.finishedAt = now;
      }
      if (willChangeStatus && requestedStatus === "CANCELADO") {
        updateData.finishedAt = now;
      }

      const updatedInventory = await prisma.$transaction(async (tx) => {
        const updated = await tx.inventory.update({
          where: { id: req.inventoryId },
          data: updateData,
        });

        if (requestedName && requestedName !== inventory.name) {
          await recordInventoryAudit(tx, {
            inventoryId: req.inventoryId,
            action: "INVENTORY_UPDATED",
            field: "name",
            fromValue: inventory.name,
            toValue: requestedName,
            metadata: null,
            changedBy: req.user?.sub || "unknown",
          });
        }

        if (willChangeStatus) {
          if (tx.inventoryStatusHistory) {
            await tx.inventoryStatusHistory.create({
              data: {
                inventoryId: req.inventoryId,
                fromStatus: inventory.statusOperacao,
                toStatus: requestedStatus,
                changedBy: req.user?.sub || "unknown",
              },
            });
          } else {
            await tx.$executeRaw`
              INSERT INTO inventory_status_history
              (id, inventoryId, fromStatus, toStatus, changedBy, changedAt)
              VALUES
              (${`hist_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}, ${req.inventoryId}, ${inventory.statusOperacao}, ${requestedStatus}, ${req.user?.sub || "unknown"}, ${new Date()})
            `;
          }

          await recordInventoryAudit(tx, {
            inventoryId: req.inventoryId,
            action: "INVENTORY_STATUS_CHANGED",
            field: "statusOperacao",
            fromValue: inventory.statusOperacao,
            toValue: requestedStatus,
            metadata: null,
            changedBy: req.user?.sub || "unknown",
          });
        }

        return updated;
      });

      return res.json({
        success: true,
        inventory: {
          id: updatedInventory.id,
          name: updatedInventory.name,
          campus: updatedInventory.campus,
          statusOperacao: updatedInventory.statusOperacao,
          sourceType: updatedInventory.sourceType,
          startedAt: updatedInventory.startedAt,
          finishedAt: updatedInventory.finishedAt,
          updatedAt: updatedInventory.updatedAt,
        },
      });
    } catch (error) {
      console.error("Error updating inventory metadata:", error);
      return res.status(500).json({ error: "Erro ao atualizar inventário" });
    }
  },
);

router.get(
  "/:inventoryId/permissions",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const members = await prisma.inventoryUser.findMany({
        where: { inventoryId: req.inventoryId },
        include: {
          user: {
            select: {
              id: true,
              samAccountName: true,
              fullName: true,
              role: true,
            },
          },
        },
        orderBy: [{ role: "asc" }, { user: { fullName: "asc" } }],
      });

      return res.json(
        members.map((member) => ({
          userId: member.user.id,
          samAccountName: member.user.samAccountName,
          fullName: member.user.fullName,
          globalRole: member.user.role,
          inventoryRole: member.role,
          createdAt: member.createdAt,
          updatedAt: member.updatedAt,
        })),
      );
    } catch (error) {
      console.error("Error listing inventory members:", error);
      return res.status(500).json({ error: "Erro ao listar permissões" });
    }
  },
);

router.get(
  "/:inventoryId/permissions/search",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const q = req.query.q?.toString().trim();
      if (!q || q.length < 2) {
        return res
          .status(400)
          .json({ error: "Informe ao menos 2 caracteres para busca" });
      }

      const localUsers = await prisma.user.findMany({
        where: {
          OR: [
            { samAccountName: { contains: q } },
            { fullName: { contains: q } },
          ],
        },
        include: {
          inventoryLinks: {
            where: { inventoryId: req.inventoryId },
            select: { role: true },
          },
        },
        orderBy: { fullName: "asc" },
        take: 15,
      });

      const mergedUsers = new Map();

      for (const user of localUsers) {
        const samAccountName = user.samAccountName?.toLowerCase();
        if (!samAccountName) continue;

        mergedUsers.set(samAccountName, {
          userId: user.id,
          samAccountName: user.samAccountName,
          fullName: user.fullName,
          existsLocally: true,
          alreadyLinked: user.inventoryLinks.length > 0,
          inventoryRole: user.inventoryLinks[0]?.role || null,
        });
      }

      return res.json({
        source: "LOCAL",
        users: Array.from(mergedUsers.values()).slice(0, 15),
      });
    } catch (error) {
      console.error("Error searching users for permission:", error);
      return res.status(500).json({ error: "Erro ao buscar usuários" });
    }
  },
);

router.post(
  "/:inventoryId/permissions",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const samAccountName = req.body?.samAccountName?.toString().trim();
      const requestedRole = req.body?.role?.toString().trim() || "CONFERENTE";

      if (!samAccountName) {
        return res.status(400).json({ error: "samAccountName é obrigatório" });
      }

      if (!isValidInventoryRole(requestedRole)) {
        return res.status(400).json({ error: "Perfil de inventário inválido" });
      }

      let user = await prisma.user.findUnique({
        where: { samAccountName },
      });

      if (!user) {
        const directoryUser = await findDirectoryUserBySam(samAccountName);
        if (!directoryUser) {
          return res
            .status(404)
            .json({ error: "Usuário não encontrado no banco local nem no AD" });
        }

        user = await prisma.user.create({
          data: {
            samAccountName: directoryUser.sAMAccountName,
            fullName: directoryUser.fullName || directoryUser.sAMAccountName,
            role: "CONFERENTE",
          },
        });
      }

      const membership = await prisma.inventoryUser.upsert({
        where: {
          inventoryId_userId: {
            inventoryId: req.inventoryId,
            userId: user.id,
          },
        },
        create: {
          inventoryId: req.inventoryId,
          userId: user.id,
          role: requestedRole,
        },
        update: {
          role: requestedRole,
        },
      });

      await recordInventoryAudit(prisma, {
        inventoryId: req.inventoryId,
        action: "INVENTORY_PERMISSION_UPSERT",
        field: "permission",
        fromValue: null,
        toValue: `${user.samAccountName}:${membership.role}`,
        metadata: JSON.stringify({
          userId: user.id,
          role: membership.role,
        }),
        changedBy: req.user?.sub || "unknown",
      });

      return res.status(201).json({
        success: true,
        member: {
          userId: user.id,
          samAccountName: user.samAccountName,
          fullName: user.fullName,
          inventoryRole: membership.role,
        },
      });
    } catch (error) {
      console.error("Error adding inventory member:", error);
      return res.status(500).json({ error: "Erro ao adicionar permissão" });
    }
  },
);

router.patch(
  "/:inventoryId/permissions/:userId",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const requestedRole = req.body?.role?.toString().trim();

      if (!requestedRole || !isValidInventoryRole(requestedRole)) {
        return res.status(400).json({ error: "Perfil de inventário inválido" });
      }

      const updated = await prisma.inventoryUser.updateMany({
        where: {
          inventoryId: req.inventoryId,
          userId,
        },
        data: {
          role: requestedRole,
        },
      });

      if (updated.count === 0) {
        return res.status(404).json({ error: "Vínculo não encontrado" });
      }

      await recordInventoryAudit(prisma, {
        inventoryId: req.inventoryId,
        action: "INVENTORY_PERMISSION_UPDATED",
        field: "permission",
        fromValue: null,
        toValue: `${userId}:${requestedRole}`,
        metadata: JSON.stringify({
          userId,
          role: requestedRole,
        }),
        changedBy: req.user?.sub || "unknown",
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("Error updating inventory role:", error);
      return res.status(500).json({ error: "Erro ao atualizar perfil" });
    }
  },
);

router.delete(
  "/:inventoryId/permissions/:userId",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const deleted = await prisma.inventoryUser.deleteMany({
        where: {
          inventoryId: req.inventoryId,
          userId,
        },
      });

      if (deleted.count === 0) {
        return res.status(404).json({ error: "Vínculo não encontrado" });
      }

      await recordInventoryAudit(prisma, {
        inventoryId: req.inventoryId,
        action: "INVENTORY_PERMISSION_REMOVED",
        field: "permission",
        fromValue: userId,
        toValue: null,
        metadata: JSON.stringify({ userId }),
        changedBy: req.user?.sub || "unknown",
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("Error removing inventory member:", error);
      return res.status(500).json({ error: "Erro ao remover permissão" });
    }
  },
);

router.get(
  "/:inventoryId/audit-log",
  verifyJWT,
  requireInventoryAccess(),
  requireInventoryRoles("ADMIN_CICLO"),
  async (req, res) => {
    try {
      await ensureInventoryAuditLogTable(prisma);

      const rows = await prisma.$queryRaw`
        SELECT id, action, field, fromValue, toValue, metadata, changedBy, changedAt
        FROM inventory_audit_log
        WHERE inventoryId = ${req.inventoryId}
        ORDER BY changedAt DESC
        LIMIT 200
      `;

      return res.json(
        rows.map((row) => ({
          id: row.id,
          action: row.action,
          field: row.field,
          fromValue: row.fromValue,
          toValue: row.toValue,
          metadata: row.metadata ? JSON.parse(row.metadata) : null,
          changedBy: row.changedBy,
          changedAt: row.changedAt,
        })),
      );
    } catch (error) {
      console.error("Error loading inventory audit log:", error);
      return res
        .status(500)
        .json({ error: "Erro ao carregar trilha de auditoria" });
    }
  },
);

router.get(
  "/:inventoryId",
  verifyJWT,
  requireInventoryAccess(),
  async (req, res) => {
    try {
      const inventory = await prisma.inventory.findUnique({
        where: { id: req.inventoryId },
        include: {
          createdBy: {
            select: {
              id: true,
              fullName: true,
              samAccountName: true,
            },
          },
          _count: {
            select: {
              spaces: true,
              items: true,
              users: true,
            },
          },
        },
      });

      if (!inventory) {
        return res.status(404).json({ error: "Inventário não encontrado" });
      }

      return res.json({
        id: inventory.id,
        name: inventory.name,
        campus: inventory.campus,
        sourceType: inventory.sourceType,
        statusOperacao: inventory.statusOperacao,
        baseInventoryId: inventory.baseInventoryId,
        startedAt: inventory.startedAt,
        finishedAt: inventory.finishedAt,
        createdAt: inventory.createdAt,
        updatedAt: inventory.updatedAt,
        owner: inventory.createdBy
          ? {
              id: inventory.createdBy.id,
              fullName: inventory.createdBy.fullName,
              samAccountName: inventory.createdBy.samAccountName,
            }
          : null,
        counts: {
          spaces: inventory._count.spaces,
          items: inventory._count.items,
          users: inventory._count.users,
        },
      });
    } catch (error) {
      console.error("Error loading inventory details:", error);
      return res.status(500).json({ error: "Erro ao carregar inventário" });
    }
  },
);

export default router;
