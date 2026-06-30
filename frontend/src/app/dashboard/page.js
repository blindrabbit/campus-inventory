"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../components/Toast/toastContext";
import { useSSE } from "../../lib/useSSE";
import Modal from "../../components/Modal/Modal";
import ModalBody from "../../components/Modal/ModalBody";
import ModalFooter from "../../components/Modal/ModalFooter";
import SpaceSearchBar from "../../components/SpaceSearchBar/SpaceSearchBar";
import StrategicDashboardPanel from "../../components/StrategicDashboardPanel/StrategicDashboardPanel";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
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
const STATUS_LABELS = {
  NAO_INICIADO: "Não iniciado",
  EM_EXECUCAO: "Iniciado",
  PAUSADO: "Suspenso",
  EM_AUDITORIA: "Em Auditoria",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
};
const STATUS_BADGE_STYLES = {
  NAO_INICIADO: "bg-slate-100 text-slate-700 ring-slate-200",
  EM_EXECUCAO: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  PAUSADO: "bg-amber-100 text-amber-700 ring-amber-200",
  EM_AUDITORIA: "bg-sky-100 text-sky-700 ring-sky-200",
  FINALIZADO: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  CANCELADO: "bg-rose-100 text-rose-700 ring-rose-200",
};

// Fase visual do card de espaço (determina cor e ordem de exibição)
const SPACE_PHASE_ORDER = { NAO_INICIADO: 0, INICIADO: 1, FINALIZADO: 2, CONFERIDO: 3, DESATIVADO: 4 };
const SPACE_PHASE_STYLES = {
  DESATIVADO: {
    card: "border-zinc-300 bg-zinc-100 opacity-85",
    title: "text-zinc-700",
    arrow: "text-zinc-500",
    footerBorder: "border-zinc-200",
  },
  NAO_INICIADO: {
    card: "border-gray-100 bg-white",
    title: "group-hover:text-blue-600",
    arrow: "text-blue-600",
    footerBorder: "border-gray-100",
  },
  INICIADO: {
    card: "border-amber-200 bg-amber-50/50",
    title: "group-hover:text-amber-700",
    arrow: "text-amber-600",
    footerBorder: "border-amber-100",
  },
  FINALIZADO: {
    card: "border-emerald-200 bg-emerald-50/50",
    title: "group-hover:text-emerald-700",
    arrow: "text-emerald-600",
    footerBorder: "border-emerald-100",
  },
  CONFERIDO: {
    card: "border-purple-200 bg-purple-50/50",
    title: "group-hover:text-purple-700",
    arrow: "text-purple-600",
    footerBorder: "border-purple-100",
  },
};
const DASHBOARD_TABS = [
  {
    id: "espacos",
    label: "Espaços",
  },
  {
    id: "nao-localizados",
    label: "Não Localizados",
  },
  {
    id: "duplicatas",
    label: "Duplicatas",
  },
  {
    id: "criar-grupos",
    label: "Criar Grupos",
  },
];
const ADMIN_MENU_TAB_IDS = ["usuarios", "dados", "backups"];
const UNFOUND_TABLE_COLUMNS = [
  { key: "patrimonio", label: "N patrimonio", align: "left" },
  { key: "descricao", label: "Descrição", align: "left" },
  { key: "localAnterior", label: "Onde ele estava", align: "left" },
  { key: "dataAquisicao", label: "Data de aquisição", align: "left" },
  { key: "valor", label: "Valor do bem", align: "right" },
];

const HISTORY_ACTION_LABELS = {
  ENCONTRADO: "Encontrado",
  NAO_LOCALIZADO: "Não localizado",
  DESFEITO_NAO_LOCALIZADO: "Não localizado desfeito",
  REALOCADO: "Realocado",
  ESTORNADO: "Estornado",
  VERIFICADO: "Verificado",
  NAO_LOCALIZADO_VERIFICACAO: "Não localizado na verificação",
};

function normalizeComparableText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getUnfoundInitialOrigin(item) {
  const history = Array.isArray(item?.historicoLocalizacoes)
    ? [...item.historicoLocalizacoes].sort(
        (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
      )
    : [];
  const firstOrigin = history.find((entry) => entry.fromSpaceName)?.fromSpaceName;

  return (
    firstOrigin ||
    item?.marcadoOnde ||
    item?.ultimoLocalConhecido ||
    item?.space?.name ||
    ""
  );
}

function getUnfoundSortValue(item, key) {
  if (key === "localAnterior") {
    return getUnfoundInitialOrigin(item);
  }

  if (key === "dataAquisicao") {
    return item.dataAquisicao ? new Date(item.dataAquisicao).getTime() : null;
  }

  if (key === "valor") {
    return typeof item.valor === "number" ? item.valor : null;
  }

  return item[key] ?? "";
}

function compareNullableValues(aValue, bValue, direction) {
  const aEmpty = aValue === null || aValue === undefined || aValue === "";
  const bEmpty = bValue === null || bValue === undefined || bValue === "";

  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const multiplier = direction === "desc" ? -1 : 1;

  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * multiplier;
  }

  return (
    String(aValue).localeCompare(String(bValue), "pt-BR", {
      numeric: true,
      sensitivity: "base",
    }) * multiplier
  );
}

function formatCurrencyValue(value) {
  if (typeof value !== "number") return "-";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatHistoryAction(action) {
  return HISTORY_ACTION_LABELS[action] || action || "Movimentação";
}

function UnfoundItemsTable({
  items,
  sorts,
  onSort,
  expandedItems,
  onToggleItem,
  onMoveItem,
  abbreviateName,
  fmtDate,
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {UNFOUND_TABLE_COLUMNS.map((column) => {
                const sortIndex = sorts.findIndex((rule) => rule.key === column.key);
                const isActive = sortIndex !== -1;
                return (
                  <th
                    key={column.key}
                    className={`px-4 py-3 ${
                      column.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(event) =>
                        onSort(
                          column.key,
                          event.shiftKey || event.ctrlKey || event.metaKey,
                        )
                      }
                      title="Clique para ordenar. Shift, Ctrl ou Cmd adiciona ordenação em grupo."
                      className={`inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-slate-200 ${
                        isActive ? "text-slate-900" : "text-slate-500"
                      }`}
                    >
                      <span className="truncate">{column.label}</span>
                      <span className="shrink-0 text-[11px]">
                        {isActive
                          ? `${sorts[sortIndex].direction === "asc" ? "↑" : "↓"}${
                              sorts.length > 1 ? sortIndex + 1 : ""
                            }`
                          : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {items.map((item) => {
              const isExpanded = !!expandedItems[item.id];
              const localAnterior = getUnfoundInitialOrigin(item) || "-";
              const history = Array.isArray(item.historicoLocalizacoes)
                ? [...item.historicoLocalizacoes].sort(
                    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
                  )
                : [];

              return (
                <Fragment key={item.id}>
                  <tr key={item.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <button
                        type="button"
                        onClick={() => onToggleItem(item.id)}
                        className="inline-flex items-center gap-2 rounded text-left hover:text-blue-700"
                        aria-expanded={isExpanded}
                      >
                        <span>{isExpanded ? "▲" : "▼"}</span>
                        <span>#{item.patrimonio || "-"}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <p className="line-clamp-2">{item.descricao || "-"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{localAnterior}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {fmtDate(item.dataAquisicao)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                      {formatCurrencyValue(item.valor)}
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="bg-slate-50">
                      <td colSpan={UNFOUND_TABLE_COLUMNS.length} className="px-4 py-4">
                        <div className="grid gap-3 text-sm md:grid-cols-4">
                          <div>
                            <p className="text-xs font-medium uppercase text-slate-500">
                              Marcado por
                            </p>
                            <p className="mt-1 text-slate-900">
                              {item.marcadoPorQuem && item.marcadoPorQuem !== "-"
                                ? abbreviateName(item.marcadoPorQuem)
                                : "-"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase text-slate-500">
                              Marcado em
                            </p>
                            <p className="mt-1 text-slate-900">
                              {item.marcadoEm
                                ? new Date(item.marcadoEm).toLocaleString("pt-BR")
                                : "-"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase text-slate-500">
                              Condição visual
                            </p>
                            <p className="mt-1 text-slate-900">
                              {item.condicaoVisual || "-"}
                            </p>
                          </div>
                          <div className="flex items-end md:justify-end">
                            <button
                              type="button"
                              onClick={() => onMoveItem(item)}
                              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                            >
                              Mover para outra sala
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 border-t border-slate-200 pt-4">
                          <p className="text-xs font-medium uppercase text-slate-500">
                            Histórico de movimentações neste inventário
                          </p>
                          {history.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-500">
                              Nenhuma movimentação registrada para este item.
                            </p>
                          ) : (
                            <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
                              <table className="min-w-full text-left text-xs">
                                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2 font-semibold">Data/Hora</th>
                                    <th className="px-3 py-2 font-semibold">Ação</th>
                                    <th className="px-3 py-2 font-semibold">De</th>
                                    <th className="px-3 py-2 font-semibold">Para</th>
                                    <th className="px-3 py-2 font-semibold">Responsável</th>
                                    <th className="px-3 py-2 font-semibold">Justificativa</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {history.map((entry) => (
                                    <tr key={entry.id}>
                                      <td className="px-3 py-2 text-slate-600">
                                        {entry.createdAt
                                          ? new Date(entry.createdAt).toLocaleString("pt-BR")
                                          : "-"}
                                      </td>
                                      <td className="px-3 py-2 font-medium text-slate-800">
                                        {formatHistoryAction(entry.action)}
                                      </td>
                                      <td className="px-3 py-2 text-slate-600">
                                        {entry.fromSpaceName || "-"}
                                      </td>
                                      <td className="px-3 py-2 text-slate-600">
                                        {entry.toSpaceName || "-"}
                                      </td>
                                      <td className="px-3 py-2 text-slate-600">
                                        {entry.createdBy || "-"}
                                      </td>
                                      <td className="px-3 py-2 text-slate-500">
                                        {entry.reason || "-"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DupItemCard({ item, onResolve }) {
  const statusLabel = item.statusEncontrado === "SIM"
    ? "Encontrado"
    : item.statusEncontrado === "NAO"
      ? "Não localizado"
      : "Pendente";
  const statusClass = item.statusEncontrado === "SIM"
    ? "bg-green-100 text-green-700"
    : item.statusEncontrado === "NAO"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";

  return (
    <div className="rounded-xl border-l-4 border-orange-400 bg-orange-50 p-4 flex flex-col sm:flex-row sm:items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-bold text-slate-800">#{item.patrimonio || "—"}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
            {statusLabel}
          </span>
          {item.space?.isFinalized && (
            <span className="text-xs px-2 py-0.5 bg-slate-200 text-slate-700 rounded-full font-medium">
              🔒 Sala lacrada
            </span>
          )}
        </div>
        <p className="text-sm text-slate-700 truncate">{item.descricao}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Sala: <span className="font-medium">{item.space?.name || "—"}</span>
          {item.itemGroup && (
            <> · Grupo: <span className="font-medium">{item.itemGroup.name}</span></>
          )}
        </p>
        {item.duplicateNotes && (
          <p className="mt-2 text-xs text-orange-800 bg-orange-100 rounded px-2 py-1 italic">
            "{item.duplicateNotes}"
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onResolve(item, "dismiss")}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium"
        >
          ✓ Dispensar
        </button>
        <button
          type="button"
          onClick={() => onResolve(item, "confirm")}
          className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium"
        >
          🗑 Confirmar duplicata
        </button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [spaceModal, setSpaceModal] = useState(null);
  const [activeInventory, setActiveInventory] = useState(null);
  const [spaceForm, setSpaceForm] = useState({
    name: "",
    responsible: "",
    sector: "",
    unit: "",
  });
  const [activeTab, setActiveTab] = useState("espacos");
  const [inventoryDetails, setInventoryDetails] = useState(null);
  const [inventoryNameDraft, setInventoryNameDraft] = useState("");
  const [inventoryStatusDraft, setInventoryStatusDraft] =
    useState("NAO_INICIADO");
  const [savingInventorySettings, setSavingInventorySettings] = useState(false);
  const [statusHistory, setStatusHistory] = useState([]);
  const [loadingStatusHistory, setLoadingStatusHistory] = useState(false);
  const [members, setMembers] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [newMemberRole, setNewMemberRole] = useState("CONFERENTE");
  const [allItems, setAllItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [groupedItems, setGroupedItems] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [groupCreationModal, setGroupCreationModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [itemGroups, setItemGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [expandedCreatedGroups, setExpandedCreatedGroups] = useState({});
  const [groupSubTab, setGroupSubTab] = useState("itens");

  // Editar grupo
  const [editGroupModal, setEditGroupModal] = useState(null); // group object
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupDesc, setEditGroupDesc] = useState("");
  const [savingEditGroup, setSavingEditGroup] = useState(false);

  // Excluir grupo
  const [deleteGroupModal, setDeleteGroupModal] = useState(null); // group object
  const [deletingGroup, setDeletingGroup] = useState(false);

  // Dividir grupo
  const [splitGroupModal, setSplitGroupModal] = useState(null); // group object
  const [splitGroupSelected, setSplitGroupSelected] = useState(new Set());
  const [splitGroupNewName, setSplitGroupNewName] = useState("");
  const [splittingGroup, setSplittingGroup] = useState(false);

  // Estados para aba "Duplicatas"
  const [duplicateItems, setDuplicateItems] = useState([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);

  // Estados para aba "Não Localizados"
  const [unfoundItems, setUnfoundItems] = useState([]);
  const [unfoundLoading, setUnfoundLoading] = useState(false);
  const [expandedUnfoundItem, setExpandedUnfoundItem] = useState(null);
  const [unfoundSubTab, setUnfoundSubTab] = useState("itens");
  const [unfoundItemHistory, setUnfoundItemHistory] = useState([]);
  const [unfoundHistoryLoading, setUnfoundHistoryLoading] = useState(false);
  const [expandedUnfoundItems, setExpandedUnfoundItems] = useState({});
  const [unfoundActionModal, setUnfoundActionModal] = useState(null); // { item, action: "mover" }
  const [unfoundCondicao, setUnfoundCondicao] = useState("BOM");
  const [unfoundMoveTargetSpaceId, setUnfoundMoveTargetSpaceId] = useState("");
  const [savingUnfoundAction, setSavingUnfoundAction] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [dashboardSummaryLoading, setDashboardSummaryLoading] = useState(false);
  const [dashboardSummaryError, setDashboardSummaryError] = useState("");
  const [dashboardSummaryDenied, setDashboardSummaryDenied] = useState(false);

  // Filtros / agrupamento — Não Localizados
  const [unfoundSearch, setUnfoundSearch] = useState("");
  const [unfoundFilterRoom, setUnfoundFilterRoom] = useState("");
  const [unfoundGroupByRoom, setUnfoundGroupByRoom] = useState(false);
  const [unfoundSorts, setUnfoundSorts] = useState([
    { key: "patrimonio", direction: "asc" },
  ]);

  // Filtros / agrupamento — Duplicatas
  const [dupSearch, setDupSearch] = useState("");
  const [dupFilterRoom, setDupFilterRoom] = useState("");
  const [dupFilterStatus, setDupFilterStatus] = useState("");
  const [dupGroupByRoom, setDupGroupByRoom] = useState(false);

  // Backup state
  const [backupInventories, setBackupInventories] = useState([]); // inventories the user can manage backups for
  const [backupSelectedInventoryId, setBackupSelectedInventoryId] = useState(null);
  const [backupList, setBackupList] = useState([]);
  const [backupSchedule, setBackupSchedule] = useState(null);
  const [backupLockStatus, setBackupLockStatus] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [backupLabelInput, setBackupLabelInput] = useState("");
  const [scheduleIntervalInput, setScheduleIntervalInput] = useState("");
  const [backupRestoreId, setBackupRestoreId] = useState(null);
  const [backupDeleteId, setBackupDeleteId] = useState(null);
  const [backupConfirmAction, setBackupConfirmAction] = useState(null); // "restore" | "delete"
  const [dashboardRecentEvents, setDashboardRecentEvents] = useState([]);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  // Banner de retomada de sessão
  const [sessionSummary, setSessionSummary] = useState(null);
  const [sessionBannerOpen, setSessionBannerOpen] = useState(true);
  // Tracks which inventoryId already had its session summary loaded, so we don't repeat it
  const sessionSummaryLoadedForRef = useRef(null);

  const router = useRouter();
  const { showToast } = useToast();

  // SSE — listen for realtime events across the entire inventory
  const currentInventoryId =
    typeof window !== "undefined"
      ? localStorage.getItem("activeInventoryId")
      : null;
  const { lastEvent } = useSSE({
    inventoryId: currentInventoryId,
    spaceId: null, // no space filter — see all events for this inventory
    enabled: !!currentInventoryId && activeTab === "estrategico",
  });

  // React to SSE events — show toast and refresh data
  const loadSpacesRef = useRef(null);
  const loadDashboardSummaryRef = useRef(null);
  useEffect(() => {
    if (!lastEvent) return;
    const token = localStorage.getItem("token");
    if (!token || !currentInventoryId || !loadSpacesRef.current) return;

    const config = {
      item_relocated: {
        title: "📦 Item realocado",
        msg: `${lastEvent.data.user} moveu um item para outra sala.`,
      },
      group_relocated: {
        title: `📦 Grupo realocado`,
        msg: `${lastEvent.data.user} moveu ${lastEvent.data.count} itens de um grupo.`,
      },
      item_checked: {
        title: "✅ Item conferido",
        msg: `${lastEvent.data.user} marcou um item como encontrado.`,
      },
      item_unfound: {
        title: "Item nao localizado",
        msg: `${lastEvent.data.user} marcou um item como nao localizado.`,
      },
      item_unchecked: {
        title: "Conferencia desfeita",
        msg: `${lastEvent.data.user} desfez a conferencia de um item.`,
      },
      item_verified: {
        title: "Item verificado",
        msg: `${lastEvent.data.user} confirmou um item na reverificacao.`,
      },
      batch_checked: {
        title: "✅ Conferência em massa",
        msg: `${lastEvent.data.user} conferiu ${lastEvent.data.count} itens.`,
      },
      batch_unfound: {
        title: "Não localizados em massa",
        msg: `${lastEvent.data.user} marcou ${lastEvent.data.count} itens como não localizados.`,
      },
      batch_relocated: {
        title: "📦 Movimentação em massa",
        msg: `${lastEvent.data.user} moveu ${lastEvent.data.count} itens em lote.`,
      },
      item_restored: {
        title: "🔄 Item restaurado",
        msg: `${lastEvent.data.user} restaurou um item.`,
      },
    };

    const c = config[lastEvent.type];
    if (c) {
      showToast({ type: "info", title: c.title, message: c.msg });
      setDashboardRecentEvents((prev) => {
        const nextEvent = {
          type: lastEvent.type,
          data: lastEvent.data,
          receivedAt: new Date().toISOString(),
        };
        return [nextEvent, ...prev].slice(0, 8);
      });
      // Refresh dashboard data
      if (loadSpacesRef.current) {
        loadSpacesRef.current(token, currentInventoryId);
      }
      if (!dashboardSummaryDenied && loadDashboardSummaryRef.current) {
        loadDashboardSummaryRef.current(token, currentInventoryId);
      }
    }
  }, [lastEvent, showToast, currentInventoryId, dashboardSummaryDenied]);

  const isInventoryAdmin = useMemo(() => {
    if (user?.role === "ADMIN") return true;
    return activeInventory?.role === "ADMIN_CICLO";
  }, [user, activeInventory]);

  const canManageSpaces = useMemo(() => {
    return isInventoryAdmin || activeInventory?.role === "REVISOR";
  }, [isInventoryAdmin, activeInventory?.role]);

  const visibleTabs = useMemo(() => {
    if (isInventoryAdmin) return DASHBOARD_TABS;
    const inventoryRole = activeInventory?.role;
    if (inventoryRole === "REVISOR") {
      return DASHBOARD_TABS.filter(
        (tab) => tab.id === "espacos" || tab.id === "criar-grupos",
      );
    }
    // CONFERENTE e VISUALIZADOR veem apenas a aba de espaços
    return DASHBOARD_TABS.filter((tab) => tab.id === "espacos");
  }, [isInventoryAdmin, activeInventory?.role]);

  const filteredGroupedItems = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    if (!term) return groupedItems;
    const result = {};
    for (const [descricao, items] of Object.entries(groupedItems)) {
      const matchedItems = items.filter(
        (item) =>
          item.patrimonio?.toLowerCase().includes(term) ||
          descricao.toLowerCase().includes(term) ||
          item.space?.name?.toLowerCase().includes(term),
      );
      if (matchedItems.length > 0) result[descricao] = matchedItems;
    }
    return result;
  }, [groupedItems, itemSearch]);

  const getItemOrderPriority = (item) => {
    if (item?.meta?.isRelocated) return 0;
    if (item?.statusEncontrado === "SIM") return 2;
    return 1;
  };

  const compareItemsByPriority = (a, b) => {
    const priorityDiff = getItemOrderPriority(a) - getItemOrderPriority(b);
    if (priorityDiff !== 0) return priorityDiff;

    return (a?.patrimonio || "").localeCompare(b?.patrimonio || "", "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  };

  const hasAuditAccess = useMemo(() => {
    return user?.role === "ADMIN" || activeInventory?.role === "ADMIN_CICLO";
  }, [user, activeInventory]);

  const getSpacePhase = (space) => {
    if (space.isActive === false) return "DESATIVADO";
    if (space.isVerified && space.confirmedBy) return "CONFERIDO";
    if (space.isFinalized || space.executionStatus === "FINALIZADO") return "FINALIZADO";
    if (space.startedAt || space.executionStatus === "INICIADO") return "INICIADO";
    return "NAO_INICIADO";
  };

  const sortedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => {
      const phaseA = SPACE_PHASE_ORDER[getSpacePhase(a)];
      const phaseB = SPACE_PHASE_ORDER[getSpacePhase(b)];
      if (phaseA !== phaseB) return phaseA - phaseB;
      return (a.name || "").localeCompare(b.name || "", "pt-BR", { sensitivity: "base" });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces]);

  const fmtDate = (value) =>
    value ? new Date(value).toLocaleDateString("pt-BR") : "--/--/--";

  const fmtDateTime = (value) =>
    value ? new Date(value).toLocaleString("pt-BR") : "--";

  const fmtBytes = (bytes) => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const loadBackupInventories = async (activeId) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const { data } = await axios.get(`${API}/inventories/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const eligible = (data || []).filter((inv) => inv.role === "ADMIN_CICLO");
      setBackupInventories(eligible);
      // Default to active inventory if eligible, otherwise first in list
      const preferred = eligible.find((inv) => inv.id === activeId) || eligible[0];
      if (preferred) setBackupSelectedInventoryId((prev) => prev || preferred.id);
    } catch {
      // silently fail
    }
  };

  const loadBackupData = async (inventoryId) => {
    const token = localStorage.getItem("token");
    const id = inventoryId || backupSelectedInventoryId || activeInventory?.id;
    if (!token || !id) return;
    setBackupListLoading(true);
    try {
      const [listRes, schedRes, lockRes] = await Promise.all([
        axios.get(`${API}/backups`, { params: { inventoryId: id }, headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/backups/schedule`, { params: { inventoryId: id }, headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/backups/lock-status`, { params: { inventoryId: id }, headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setBackupList(listRes.data);
      setBackupSchedule(schedRes.data);
      setBackupLockStatus(lockRes.data);
      if (schedRes.data) setScheduleIntervalInput(String(schedRes.data.intervalHours));
    } catch {
      // silently fail — not critical
    } finally {
      setBackupListLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    if (!token || !inventoryId) return;
    setBackupLoading(true);
    try {
      const { data } = await axios.post(
        `${API}/backups`,
        { label: backupLabelInput.trim() || undefined, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setBackupList((prev) => [data, ...prev]);
      setBackupLabelInput("");
      showToast({ type: "success", title: "Backup criado", message: "Arquivo SQL gerado com sucesso." });
    } catch (err) {
      showToast({ type: "error", title: "Erro ao criar backup", message: err.response?.data?.error || "Tente novamente." });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleSaveSchedule = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    const hours = parseInt(scheduleIntervalInput, 10);
    if (!hours || hours < 1) {
      showToast({ type: "error", title: "Intervalo inválido", message: "Digite ao menos 1 hora." });
      return;
    }
    try {
      const { data } = await axios.post(
        `${API}/backups/schedule`,
        { intervalHours: hours, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setBackupSchedule(data);
      showToast({ type: "success", title: "Agendamento salvo", message: `Backup automático a cada ${hours}h configurado.` });
    } catch (err) {
      showToast({ type: "error", title: "Erro", message: err.response?.data?.error || "Erro ao salvar agendamento." });
    }
  };

  const handleDeleteSchedule = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    try {
      await axios.delete(`${API}/backups/schedule`, { params: { inventoryId }, headers: { Authorization: `Bearer ${token}` } });
      setBackupSchedule(null);
      setScheduleIntervalInput("");
      showToast({ type: "success", title: "Agendamento removido", message: "Backup automático desativado." });
    } catch {
      showToast({ type: "error", title: "Erro", message: "Não foi possível remover o agendamento." });
    }
  };

  const handleDownloadBackup = (record) => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    const url = `${API}/backups/${record.id}/download?inventoryId=${inventoryId}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", record.fileName);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
      })
      .catch(() => showToast({ type: "error", title: "Erro", message: "Não foi possível baixar o backup." }));
  };

  const handleRestoreBackup = async (id) => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    try {
      await axios.post(`${API}/backups/${id}/restore`, { inventoryId }, { headers: { Authorization: `Bearer ${token}` } });
      showToast({ type: "success", title: "Restauração concluída", message: "Backup de segurança criado e inventário restaurado com sucesso." });
      await loadBackupData();
    } catch (err) {
      showToast({ type: "error", title: "Erro na restauração", message: err.response?.data?.error || "Falha ao restaurar." });
    } finally {
      setBackupConfirmAction(null);
      setBackupRestoreId(null);
    }
  };

  const handleDeleteBackup = async (id) => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    try {
      await axios.delete(`${API}/backups/${id}`, { params: { inventoryId }, headers: { Authorization: `Bearer ${token}` } });
      setBackupList((prev) => prev.filter((r) => r.id !== id));
      showToast({ type: "success", title: "Backup removido", message: "Arquivo excluído com sucesso." });
    } catch {
      showToast({ type: "error", title: "Erro", message: "Não foi possível excluir o backup." });
    } finally {
      setBackupConfirmAction(null);
      setBackupDeleteId(null);
    }
  };

  const abbreviateName = (name) => {
    if (!name) return "usuário não identificado";
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return parts[0] + " " + parts.slice(1).map((p) => p[0].toUpperCase() + ".").join(" ");
  };

  const getSpacePhaseBadges = (space) => {
    const badges = [];

    if (space.isActive === false) {
      return [
        {
          label: "DESATIVADO",
          className: "bg-zinc-200 text-zinc-700",
        },
      ];
    }

    if (space.startedAt || space.executionStatus === "INICIADO" || space.executionStatus === "FINALIZADO") {
      const date = space.startedAt ? new Date(space.startedAt).toLocaleDateString("pt-BR") : "--/--/--";
      badges.push({ label: `🟠 Iniciado em ${date} por ${abbreviateName(space.startedBy)}`, className: "bg-amber-100 text-amber-800" });
    }

    if (space.isFinalized || space.executionStatus === "FINALIZADO") {
      badges.push({ label: `🟢 Finalizado em ${fmtDate(space.finalizedAt)} por ${abbreviateName(space.finalizedBy)}`, className: "bg-emerald-100 text-emerald-800" });
    }

    if (space.isVerified && space.confirmedBy) {
      badges.push({ label: `🟣 Confirmado em ${fmtDate(space.confirmedAt)} por ${abbreviateName(space.confirmedBy)}`, className: "bg-purple-100 text-purple-800" });
    }

    if (badges.length === 0) {
      badges.push({ label: "🔴 Não iniciado", className: "bg-rose-100 text-rose-800" });
    }

    return badges;
  };

  const activeTabMeta = useMemo(
    () => visibleTabs.find((tab) => tab.id === activeTab) || visibleTabs[0],
    [activeTab, visibleTabs],
  );

  const syncActiveInventoryFromStorage = () => {
    const inventoryData = localStorage.getItem("activeInventory");
    const inventoryId = localStorage.getItem("activeInventoryId");

    if (!inventoryId) {
      setActiveInventory(null);
      return null;
    }

    const parsedInventory = inventoryData ? JSON.parse(inventoryData) : null;
    const normalizedInventory = {
      ...(parsedInventory || {}),
      id: parsedInventory?.id || inventoryId,
    };

    setActiveInventory((prev) => {
      if (
        prev?.id === normalizedInventory.id &&
        prev?.name === normalizedInventory.name &&
        prev?.role === normalizedInventory.role &&
        prev?.statusOperacao === normalizedInventory.statusOperacao
      ) {
        return prev;
      }
      return normalizedInventory;
    });

    return normalizedInventory;
  };

  useEffect(() => {
    const tabIsVisible = visibleTabs.some((tab) => tab.id === activeTab);
    const tabIsAdminMenu = isInventoryAdmin && ADMIN_MENU_TAB_IDS.includes(activeTab);
    if (!tabIsVisible && !tabIsAdminMenu) {
      setActiveTab("espacos");
    }

    const token = localStorage.getItem("token");
    if (token) {
      if (activeTab === "criar-grupos") {
        loadAllItems(token);
        loadItemGroups(token);
      }

      if (activeTab === "nao-localizados") {
        loadUnfoundItems(token);
      }

      if (activeTab === "duplicatas") {
        loadDuplicates(token);
      }

      if (activeTab === "estrategico") {
        setDashboardRecentEvents([]);
        // fire-and-forget load of the summary when switching to the tab
        loadDashboardSummary(token, localStorage.getItem("activeInventoryId"));
      }

      if (activeTab === "backups") {
        loadBackupInventories(activeInventory?.id);
      }
    }
  }, [activeTab, visibleTabs, unfoundSubTab, isInventoryAdmin]);

  // Reload backup data whenever the selected inventory changes
  useEffect(() => {
    if (activeTab === "backups" && backupSelectedInventoryId) {
      loadBackupData(backupSelectedInventoryId);
    }
  }, [backupSelectedInventoryId]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!token) {
      router.push("/login");
      return;
    }

    const normalizedInventory = syncActiveInventoryFromStorage();
    if (!normalizedInventory?.id) {
      router.push("/inventories");
      return;
    }

    const parsedUser = userData ? JSON.parse(userData) : null;
    setUser(parsedUser);

    // Refresh the inventory role from the API — localStorage can be stale
    // if an admin changed the user's role since the last session.
    const refreshInventoryRole = async () => {
      try {
        const { data } = await axios.get(`${API}/auth/inventory-role`, {
          params: { inventoryId: normalizedInventory.id },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (data.inventoryRole) {
          const updated = {
            ...normalizedInventory,
            role: data.inventoryRole,
            ...(data.statusOperacao ? { statusOperacao: data.statusOperacao } : {}),
          };
          localStorage.setItem("activeInventory", JSON.stringify(updated));
          setActiveInventory(updated);
        }
      } catch {
        // Non-critical — stale cached role will be used as fallback
      }
    };
    refreshInventoryRole();

    const handleStorage = () => {
      syncActiveInventoryFromStorage();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleStorage);
    };
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const inventoryId = activeInventory?.id;

    if (!token || !inventoryId) {
      return;
    }

    setLoading(true);

    const loadForInventory = async () => {
      setDashboardRecentEvents([]);
      await loadSpaces(token, inventoryId);
      await loadDashboardSummary(token, inventoryId);

      if (user?.role === "ADMIN" || activeInventory?.role === "ADMIN_CICLO") {
        await Promise.all([
          loadInventoryDetails(token, inventoryId),
          loadStatusHistory(token, inventoryId),
          loadPermissionsMembers(token, inventoryId),
        ]);
      }
    };

    loadForInventory();
  }, [activeInventory?.id, activeInventory?.role, user?.role]);

  // Carrega o resumo da sessão anterior independentemente do restante do dashboard.
  // Usa um ref para garantir que só roda UMA vez por inventário por montagem do componente.
  useEffect(() => {
    const inventoryId = activeInventory?.id;
    if (!inventoryId) return;
    if (sessionSummaryLoadedForRef.current === inventoryId) return;

    const token = localStorage.getItem("token");
    const previousSessionAt = localStorage.getItem("previousSessionAt");
    if (!token || !previousSessionAt) return;

    const sessionAge = Date.now() - new Date(previousSessionAt).getTime();
    const MAX_AGE_MS = 72 * 60 * 60 * 1000;

    if (sessionAge > MAX_AGE_MS) {
      localStorage.removeItem("previousSessionAt");
      return;
    }

    sessionSummaryLoadedForRef.current = inventoryId;

    axios
      .get(`${API}/users/me/session-summary`, {
        params: { inventoryId, since: previousSessionAt },
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(({ data }) => {
        if (data.totalActions > 0) {
          setSessionSummary(data);
          setSessionBannerOpen(true);
        }
      })
      .catch((err) => {
        console.error("[session-summary] Erro ao buscar resumo:", err?.response?.data || err?.message);
      });
  }, [activeInventory?.id]);

  const loadSpaces = async (token, inventoryId) => {
    try {
      const { data } = await axios.get(`${API}/spaces/active`, {
        params: { inventoryId, includeFinalized: "true" },
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpaces(data);
    } catch (err) {
      console.error("Erro ao carregar espaços:", err);
      showToast({
        type: "error",
        title: "Falha ao carregar espaços",
        message:
          err.response?.data?.error ||
          "Não foi possível carregar a lista de espaços.",
      });
      if (err.response?.status === 403) {
        localStorage.removeItem("activeInventoryId");
        localStorage.removeItem("activeInventory");
        router.push("/inventories");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("activeInventoryId");
    localStorage.removeItem("activeInventory");
    router.push("/login");
  };

  const loadAllItems = async (token) => {
    try {
      setLoadingItems(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/items/all`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });

      // Agrupar itens por descricao e patrimonio range
      const grouped = {};
      const items = Array.isArray(data) ? data : [];

      items.forEach((item) => {
        const desc = item.descricao || "Sem descrição";
        if (!grouped[desc]) {
          grouped[desc] = [];
        }
        grouped[desc].push(item);
      });

      // Ordenar itens dentro de cada grupo: movidos no topo e encontrados no final.
      Object.keys(grouped).forEach((desc) => {
        grouped[desc].sort(compareItemsByPriority);
      });

      setAllItems(items);
      setGroupedItems(grouped);
      setSelectedItems(new Set());
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao carregar itens",
        message:
          err.response?.data?.error ||
          "Não foi possível carregar os itens do inventário.",
      });
    } finally {
      setLoadingItems(false);
    }
  };

  const loadItemGroups = async (token) => {
    try {
      setLoadingGroups(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/item-groups/all`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });
      const groups = Array.isArray(data) ? data : [];
      setItemGroups(
        groups.map((group) => ({
          ...group,
          items: Array.isArray(group.items)
            ? [...group.items].sort(compareItemsByPriority)
            : [],
        })),
      );
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao carregar grupos",
        message:
          err.response?.data?.error || "Não foi possível carregar os grupos.",
      });
    } finally {
      setLoadingGroups(false);
    }
  };

  const loadDuplicates = async (token) => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;
    setDuplicatesLoading(true);
    try {
      const { data } = await axios.get(`${API}/items/duplicates`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });
      setDuplicateItems(Array.isArray(data) ? data : []);
    } catch {
      showToast({ type: "error", title: "Falha ao carregar duplicatas", message: "Não foi possível carregar os itens sinalizados." });
    } finally {
      setDuplicatesLoading(false);
    }
  };

  const handleResolveDuplicate = async (item, action) => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    try {
      await axios.patch(
        `${API}/items/${item.id}/resolve-duplicate`,
        { action, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setDuplicateItems((prev) => prev.filter((d) => d.id !== item.id));
      showToast({
        type: "success",
        title: action === "confirm" ? "Duplicata confirmada" : "Sinalização dispensada",
        message: action === "confirm"
          ? `Patrimônio ${item.patrimonio} marcado como não localizado.`
          : `Patrimônio ${item.patrimonio} voltou ao fluxo normal.`,
      });
    } catch (err) {
      showToast({ type: "error", title: "Falha", message: err.response?.data?.error || "Erro ao resolver duplicata." });
    }
  };

  const loadUnfoundItems = async (token) => {
    try {
      setUnfoundLoading(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/audit/unfound-items`, {
        params: { inventoryId, limit: 1000 },
        headers: { Authorization: `Bearer ${token}` },
      });

      const items = Array.isArray(data.items) ? data.items : [];

      // Filtrar apenas itens não localizados (excluindo movidos pendentes)
      const unfoundOnly = items.filter(
        (item) => item.statusAtual !== "MOVIDO_PENDENTE_ACEITE",
      );

      // Enriquecer itens com informação de quem marcou como NAO_LOCALIZADO
      const enrichedItems = unfoundOnly.map((item) => {
        const naoLocalizadoHistory = item.historicoLocalizacoes?.find(
          (h) => h.action === "NAO_LOCALIZADO",
        );
        return {
          ...item,
          marcadoPorQuem:
            naoLocalizadoHistory?.createdBy || item.conferente || "-",
          marcadoEm:
            naoLocalizadoHistory?.createdAt || item.dataUltimaAlteracao,
          marcadoOnde:
            naoLocalizadoHistory?.fromSpaceName || item.ultimoLocalConhecido || null,
        };
      });

      enrichedItems.sort((a, b) => {
        const aNum = parseInt(a.patrimonio) || 0;
        const bNum = parseInt(b.patrimonio) || 0;
        return aNum - bNum;
      });

      setUnfoundItems(enrichedItems);
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao carregar não localizados",
        message:
          err.response?.data?.error ||
          "Não foi possível carregar itens não localizados.",
      });
    } finally {
      setUnfoundLoading(false);
    }
  };

  const loadUnfoundItemHistory = async (token) => {
    try {
      setUnfoundHistoryLoading(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/audit/unfound-items`, {
        params: {
          inventoryId,
          limit: 100,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      // Format the unfound items to a history-like view
      const historyItems = (data.items || []).map((item) => {
        const latestMove = item.historicoLocalizacoes?.[0];
        return {
          id: item.id,
          itemPatrimonio: item.patrimonio,
          itemDescricao: item.descricao,
          userName: item.conferente || item.ultimoResponsavel,
          timestamp: item.dataUltimaAlteracao,
          action: latestMove?.action || "NAO_LOCALIZADO",
        };
      });

      setUnfoundItemHistory(historyItems);
    } catch (err) {
      // Falha silenciosa se o endpoint não existir
      console.warn("Error loading unfound item history:", err);
      setUnfoundItemHistory([]);
    } finally {
      setUnfoundHistoryLoading(false);
    }
  };

  const handleUnfoundItemAction = async (
    item,
    action,
    condicao = "BOM",
    targetSpaceId,
  ) => {
    if (!item || !action) return;

    try {
      setSavingUnfoundAction(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      if (action === "mover") {
        if (!targetSpaceId) {
          showToast({ type: "error", title: "Sala obrigatória", message: "Selecione a sala de destino." });
          return;
        }
        const { data: relocateResult } = await axios.post(
          `${API}/items/relocate`,
          { itemId: item.id, targetSpaceId, inventoryId },
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!relocateResult.undidUnfound) {
          // Movimento real para outra sala: registra condição visual
          await axios.post(
            `${API}/items/${item.id}/check`,
            { itemId: item.id, condicao, inventoryId },
            { headers: { Authorization: `Bearer ${token}` }, params: { inventoryId } },
          );
        }
        showToast({
          type: "success",
          title: relocateResult.undidUnfound ? "Marcação desfeita" : "Item movido",
          message: relocateResult.undidUnfound
            ? `Patrimônio #${item.patrimonio} voltou para pendente.`
            : `Patrimônio #${item.patrimonio} realocado com sucesso.`,
        });
        setUnfoundActionModal(null);
        setUnfoundMoveTargetSpaceId("");
        await loadUnfoundItems(token);
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao mover item",
        message: err.response?.data?.error || "Não foi possível mover o item.",
      });
    } finally {
      setSavingUnfoundAction(false);
    }
  };

  loadSpacesRef.current = async (token, inventoryId) => {
    await loadSpaces(token, inventoryId);

    if (activeTab === "criar-grupos") {
      await Promise.all([loadAllItems(token), loadItemGroups(token)]);
    }
  };

  loadDashboardSummaryRef.current = async (token, inventoryId) => {
    await loadDashboardSummary(token, inventoryId);
  };

  const handleToggleItemSelection = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      showToast({
        type: "error",
        title: "Nome obrigatório",
        message: "Digite um nome para o grupo.",
      });
      return;
    }

    if (selectedItems.size === 0) {
      showToast({
        type: "error",
        title: "Selecione itens",
        message: "Selecione pelo menos um item para criar o grupo.",
      });
      return;
    }

    try {
      setCreatingGroup(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      const itemIds = Array.from(selectedItems);

      await axios.post(
        `${API}/item-groups`,
        {
          name: newGroupName,
          description: newGroupDescription,
          itemIds,
          inventoryId,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      showToast({
        type: "success",
        title: "Grupo criado com sucesso",
        message: `${selectedItems.size} item(ns) adicionados ao grupo "${newGroupName}".`,
      });

      setNewGroupName("");
      setNewGroupDescription("");
      setGroupCreationModal(false);
      setSelectedItems(new Set());
      await Promise.all([loadAllItems(token), loadItemGroups(token)]);
      setGroupSubTab("grupos-criados");
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao criar grupo",
        message: err.response?.data?.error || "Não foi possível criar o grupo.",
      });
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleEditGroup = async () => {
    if (!editGroupName.trim()) return;
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    setSavingEditGroup(true);
    try {
      await axios.put(
        `${API}/item-groups/${editGroupModal.id}`,
        { name: editGroupName.trim(), description: editGroupDesc.trim() || null },
        { params: { inventoryId }, headers: { Authorization: `Bearer ${token}` } },
      );
      setEditGroupModal(null);
      showToast({ type: "success", title: "Grupo renomeado", message: `"${editGroupName.trim()}" salvo.` });
      await loadItemGroups(token);
    } catch (err) {
      showToast({ type: "error", title: "Falha ao salvar", message: err.response?.data?.error || "Erro ao salvar grupo." });
    } finally {
      setSavingEditGroup(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroupModal) return;
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    setDeletingGroup(true);
    try {
      await axios.delete(`${API}/item-groups/${deleteGroupModal.id}`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });
      setDeleteGroupModal(null);
      showToast({ type: "success", title: "Grupo excluído", message: `O grupo "${deleteGroupModal.name}" foi removido. Os itens permanecem no sistema.` });
      await loadItemGroups(token);
    } catch (err) {
      showToast({ type: "error", title: "Falha ao excluir", message: err.response?.data?.error || "Erro ao excluir grupo." });
    } finally {
      setDeletingGroup(false);
    }
  };

  const handleSplitGroup = async () => {
    if (!splitGroupNewName.trim() || splitGroupSelected.size === 0) return;
    if (splitGroupSelected.size >= splitGroupModal.items.length) {
      showToast({ type: "error", title: "Divisão inválida", message: "É necessário manter ao menos 1 item no grupo original." });
      return;
    }
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    setSplittingGroup(true);
    try {
      await axios.post(
        `${API}/item-groups/${splitGroupModal.id}/split`,
        { splitItemIds: [...splitGroupSelected], newGroupName: splitGroupNewName.trim() },
        { params: { inventoryId }, headers: { Authorization: `Bearer ${token}` } },
      );
      setSplitGroupModal(null);
      setSplitGroupSelected(new Set());
      setSplitGroupNewName("");
      showToast({ type: "success", title: "Grupo dividido", message: `Novo grupo "${splitGroupNewName.trim()}" criado com ${splitGroupSelected.size} iten(s).` });
      await loadItemGroups(token);
    } catch (err) {
      showToast({ type: "error", title: "Falha ao dividir", message: err.response?.data?.error || "Erro ao dividir grupo." });
    } finally {
      setSplittingGroup(false);
    }
  };

  const loadInventoryDetails = async (token, inventoryId) => {
    try {
      const { data } = await axios.get(`${API}/inventories/${inventoryId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-inventory-id": inventoryId,
        },
      });

      setInventoryDetails(data);
      setInventoryNameDraft(data?.name || "");
      setInventoryStatusDraft(data?.statusOperacao || "NAO_INICIADO");
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar dados",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os dados administrativos do inventário.",
      });
    }
  };

  const loadDashboardSummary = async (token, inventoryId) => {
    if (!token || !inventoryId) return;

    setDashboardSummaryLoading(true);
    setDashboardSummaryError("");
    setDashboardSummaryDenied(false);

    try {
      const { data } = await axios.get(`${API}/dashboard/summary`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });

      setDashboardSummary(data || null);
    } catch (error) {
      if (error.response?.status === 403) {
        setDashboardSummary(null);
        setDashboardSummaryDenied(true);
        return;
      }

      setDashboardSummary(null);
      setDashboardSummaryError(
        error.response?.data?.error ||
          "Não foi possível carregar o painel estratégico.",
      );
    } finally {
      setDashboardSummaryLoading(false);
    }
  };

  const loadStatusHistory = async (token, inventoryId) => {
    setLoadingStatusHistory(true);
    try {
      const { data } = await axios.get(
        `${API}/inventories/${inventoryId}/status-history`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      setStatusHistory(data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar histórico",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar o histórico de status.",
      });
    } finally {
      setLoadingStatusHistory(false);
    }
  };

  const handleSaveInventorySettings = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    setSavingInventorySettings(true);
    try {
      const { data } = await axios.patch(
        `${API}/inventories/${inventoryId}`,
        {
          name: inventoryNameDraft?.trim(),
          statusOperacao: inventoryStatusDraft,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      const updatedInventory = data?.inventory;
      if (updatedInventory) {
        setInventoryDetails((prev) => ({
          ...(prev || {}),
          ...updatedInventory,
        }));

        const activeInventoryRaw = localStorage.getItem("activeInventory");
        const parsed = activeInventoryRaw ? JSON.parse(activeInventoryRaw) : {};
        const updatedActive = {
          ...parsed,
          id: updatedInventory.id,
          name: updatedInventory.name,
          statusOperacao: updatedInventory.statusOperacao,
        };

        localStorage.setItem("activeInventory", JSON.stringify(updatedActive));
        setActiveInventory(updatedActive);
      }

      await loadStatusHistory(token, inventoryId);

      showToast({
        type: "success",
        title: "Inventário atualizado",
        message: "Nome e status operacional atualizados com sucesso.",
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao atualizar inventário",
        message:
          error.response?.data?.error ||
          "Não foi possível atualizar nome/status do inventário.",
      });
    } finally {
      setSavingInventorySettings(false);
    }
  };

  const loadPermissionsMembers = async (token, inventoryId) => {
    setPermissionsLoading(true);
    try {
      const { data } = await axios.get(
        `${API}/inventories/${inventoryId}/permissions`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );
      setMembers(data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar permissões",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os membros do inventário.",
      });
    } finally {
      setPermissionsLoading(false);
    }
  };

  const handleSearchUsers = async () => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    if (!searchQuery || searchQuery.trim().length < 2) {
      showToast({
        type: "warning",
        title: "Busca curta",
        message: "Digite pelo menos 2 caracteres para buscar usuários.",
      });
      return;
    }

    const token = localStorage.getItem("token");
    setSearchingUsers(true);
    try {
      const { data } = await axios.get(
        `${API}/inventories/${inventoryId}/permissions/search`,
        {
          params: { q: searchQuery.trim() },
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );
      setSearchResults(data?.users || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha na busca",
        message:
          error.response?.data?.error || "Não foi possível buscar usuários.",
      });
    } finally {
      setSearchingUsers(false);
    }
  };

  const handleAddPermission = async (result) => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    const token = localStorage.getItem("token");
    try {
      await axios.post(
        `${API}/inventories/${inventoryId}/permissions`,
        {
          samAccountName: result.samAccountName,
          role: newMemberRole,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      showToast({
        type: "success",
        title: "Permissão atualizada",
        message: `Usuário ${result.samAccountName} vinculado ao inventário.`,
      });

      await loadPermissionsMembers(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao adicionar permissão",
        message:
          error.response?.data?.error ||
          "Não foi possível vincular o usuário ao inventário.",
      });
    }
  };

  const handleUpdatePermission = async (member, role) => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    const token = localStorage.getItem("token");
    try {
      await axios.patch(
        `${API}/inventories/${inventoryId}/permissions/${member.userId}`,
        { role },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      setMembers((prev) =>
        prev.map((item) =>
          item.userId === member.userId
            ? { ...item, inventoryRole: role }
            : item,
        ),
      );
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao alterar perfil",
        message:
          error.response?.data?.error || "Não foi possível alterar o perfil.",
      });
    }
  };

  const handleRemovePermission = async (member) => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    const token = localStorage.getItem("token");
    try {
      await axios.delete(
        `${API}/inventories/${inventoryId}/permissions/${member.userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      setMembers((prev) =>
        prev.filter((item) => item.userId !== member.userId),
      );
      showToast({
        type: "success",
        title: "Permissão removida",
        message: `Acesso removido para ${member.samAccountName}.`,
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao remover permissão",
        message:
          error.response?.data?.error ||
          "Não foi possível remover a permissão.",
      });
    }
  };

  const openCreateSpaceModal = () => {
    setSpaceModal({ mode: "create" });
    setSpaceForm({ name: "", responsible: "", sector: "", unit: "" });
  };

  const openEditSpaceModal = (space) => {
    setSpaceModal({ mode: "edit", space });
    setSpaceForm({
      name: space.name || "",
      responsible: space.responsible || "",
      sector: space.sector || "",
      unit: space.unit || "",
    });
  };

  const closeSpaceModal = () => {
    setSpaceModal(null);
  };

  const submitSpaceModal = async (event) => {
    event.preventDefault();

    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    try {
      if (spaceModal?.mode === "create") {
        await axios.post(
          `${API}/spaces/admin/spaces`,
          {
            inventoryId,
            name: spaceForm.name,
            responsible: spaceForm.responsible,
            sector: spaceForm.sector,
            unit: spaceForm.unit,
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        showToast({
          type: "success",
          title: "Espaço criado",
          message: "O novo espaço foi adicionado com sucesso.",
        });
      } else if (spaceModal?.mode === "edit" && spaceModal.space) {
        await axios.put(
          `${API}/spaces/admin/spaces/${spaceModal.space.id}`,
          {
            inventoryId,
            name: spaceForm.name,
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        showToast({
          type: "success",
          title: "Espaço atualizado",
          message: "O nome do espaço foi alterado com sucesso.",
        });
      }

      closeSpaceModal();
      await loadSpaces(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title:
          spaceModal?.mode === "create"
            ? "Falha ao criar"
            : "Falha ao atualizar",
        message:
          error.response?.data?.error ||
          "Não foi possível salvar as alterações do espaço.",
      });
    }
  };

  const handleDeactivateSpace = async (space) => {
    if (!space?.id || space.itemCount > 0) return;

    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");

    try {
      await axios.delete(`${API}/spaces/admin/spaces/${space.id}`, {
        data: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast({
        type: "success",
        title: "Espaço desativado",
        message: "O espaço ficará invisível para usuários não administradores.",
      });
      await loadSpaces(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao desativar",
        message:
          error.response?.data?.error || "Não foi possível desativar o espaço.",
      });
    }
  };

  const handleReactivateSpace = async (space) => {
    if (!space?.id) return;

    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");

    try {
      await axios.post(
        `${API}/spaces/admin/spaces/${space.id}/reactivate`,
        { inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      showToast({
        type: "success",
        title: "Espaço reativado",
        message: "O espaço voltou a ficar visível para os usuários.",
      });
      await loadSpaces(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao reativar",
        message:
          error.response?.data?.error || "Não foi possível reativar o espaço.",
      });
    }
  };

  // ── Não Localizados: filtros + agrupamento ──────────────────────────────
  // Usa marcadoOnde (sala onde foi declarado não localizado) como referência de local
  const unfoundRooms = useMemo(() => {
    const seen = new Set();
    for (const i of unfoundItems) {
      const name = getUnfoundInitialOrigin(i) || "Sem sala";
      seen.add(name);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [unfoundItems]);

  const filteredUnfoundItems = useMemo(() => {
    let list = unfoundItems;
    if (unfoundSearch.trim()) {
      const q = normalizeComparableText(unfoundSearch.trim());
      list = list.filter((i) => {
        const p = normalizeComparableText(i.patrimonio);
        const d = normalizeComparableText(i.descricao);
        const s = normalizeComparableText(getUnfoundInitialOrigin(i));
        return p.includes(q) || d.includes(q) || s.includes(q);
      });
    }
    if (unfoundFilterRoom) {
      list = list.filter((i) => (getUnfoundInitialOrigin(i) || "Sem sala") === unfoundFilterRoom);
    }
    return list;
  }, [unfoundItems, unfoundSearch, unfoundFilterRoom]);

  const sortedUnfoundItems = useMemo(() => {
    const sortRules =
      unfoundSorts.length > 0
        ? unfoundSorts
        : [{ key: "patrimonio", direction: "asc" }];

    return [...filteredUnfoundItems].sort((a, b) => {
      for (const rule of sortRules) {
        const result = compareNullableValues(
          getUnfoundSortValue(a, rule.key),
          getUnfoundSortValue(b, rule.key),
          rule.direction,
        );
        if (result !== 0) return result;
      }

      return compareNullableValues(
        getUnfoundSortValue(a, "patrimonio"),
        getUnfoundSortValue(b, "patrimonio"),
        "asc",
      );
    });
  }, [filteredUnfoundItems, unfoundSorts]);

  const handleUnfoundSort = (key, grouped = false) => {
    setUnfoundSorts((current) => {
      const existing = current.find((rule) => rule.key === key);
      const nextRule = {
        key,
        direction: existing?.direction === "asc" ? "desc" : "asc",
      };

      if (!grouped) return [nextRule];

      return [nextRule, ...current.filter((rule) => rule.key !== key)];
    });
  };

  const unfoundGrouped = useMemo(() => {
    if (!unfoundGroupByRoom) return null;
    const groups = {};
    for (const item of sortedUnfoundItems) {
      const key = getUnfoundInitialOrigin(item) || "Localização não informada";
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [sortedUnfoundItems, unfoundGroupByRoom]);

  // ── Duplicatas: filtros + agrupamento ───────────────────────────────────
  const dupRooms = useMemo(() => {
    const seen = new Set();
    for (const i of duplicateItems) {
      const name = i.space?.name || "Sem sala";
      seen.add(name);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [duplicateItems]);

  const filteredDupItems = useMemo(() => {
    let list = duplicateItems;
    if (dupSearch.trim()) {
      const q = dupSearch.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      list = list.filter((i) => {
        const p = (i.patrimonio || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const d = (i.descricao || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const s = (i.space?.name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        return p.includes(q) || d.includes(q) || s.includes(q);
      });
    }
    if (dupFilterRoom) {
      list = list.filter((i) => (i.space?.name || "Sem sala") === dupFilterRoom);
    }
    if (dupFilterStatus) {
      list = list.filter((i) => i.statusEncontrado === dupFilterStatus);
    }
    return list;
  }, [duplicateItems, dupSearch, dupFilterRoom, dupFilterStatus]);

  const dupGrouped = useMemo(() => {
    if (!dupGroupByRoom) return null;
    const groups = {};
    for (const item of filteredDupItems) {
      const key = item.space?.name || "Localização não informada";
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [filteredDupItems, dupGroupByRoom]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando espaços...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-4">

            {/* Left — title */}
            <div className="shrink-0">
              <h1 className="text-2xl font-bold text-gray-900">Inventário</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Sistema de Conferência de Patrimônio
              </p>
            </div>

            {/* Center — active inventory card */}
            {activeInventory?.name ? (
              <div className="flex-1 flex justify-center">
                <div className="inline-flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 min-w-0">
                  <p className="text-xs font-semibold text-sky-800 truncate">
                    Inventário ativo: {activeInventory.name}
                  </p>
                  {activeInventory?.id ? (
                    <p className="text-[11px] text-slate-400 truncate">
                      ID: {activeInventory.id}
                    </p>
                  ) : null}
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                      STATUS_BADGE_STYLES[activeInventory?.statusOperacao] ||
                      "bg-slate-100 text-slate-700 ring-slate-200"
                    }`}
                  >
                    Status:{" "}
                    {STATUS_LABELS[activeInventory?.statusOperacao] ||
                      activeInventory?.statusOperacao ||
                      "Não informado"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-1" />
            )}

            {/* Right — user + actions */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-800">
                  {user?.samAccountName} -{" "}
                  {user?.fullName?.split(" ")[0] || user?.fullName}
                </p>
                <p className="text-xs text-gray-500">
                  {activeInventory?.role || user?.role}
                </p>
              </div>
              <button
                onClick={() => router.push("/inventories")}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Trocar inventário
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
              >
                Sair
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* Banner de retomada de sessão */}
      {sessionSummary && sessionBannerOpen && (
        <div className="border-b border-indigo-100 bg-indigo-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Cabeçalho do banner */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">📋</span>
                  <span className="text-sm font-semibold text-indigo-900">
                    Sessão anterior •{" "}
                    {new Date(localStorage.getItem("previousSessionAt")).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  <span className="text-xs text-indigo-600">
                    {sessionSummary.totalActions} {sessionSummary.totalActions !== 1 ? "ações" : "ação"} em{" "}
                    {sessionSummary.spaceSummary.length} sala{sessionSummary.spaceSummary.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Lista de salas */}
                <div className="flex flex-wrap gap-2">
                  {sessionSummary.spaceSummary.slice(0, 5).map((s) => {
                    const parts = [];
                    if (s.actions.ENCONTRADO) parts.push(`${s.actions.ENCONTRADO} encontrado${s.actions.ENCONTRADO !== 1 ? "s" : ""}`);
                    if (s.actions.NAO_LOCALIZADO) parts.push(`${s.actions.NAO_LOCALIZADO} não localizado${s.actions.NAO_LOCALIZADO !== 1 ? "s" : ""}`);
                    if (s.actions.REALOCADO) parts.push(`${s.actions.REALOCADO} realocado${s.actions.REALOCADO !== 1 ? "s" : ""}`);
                    const isLast = s.spaceId === sessionSummary.lastVisitedSpaceId;
                    return (
                      <button
                        key={s.spaceId}
                        type="button"
                        onClick={() => router.push(`/room/${s.spaceId}`)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:shadow-sm ${
                          isLast
                            ? "border-indigo-400 bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                            : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                        }`}
                      >
                        {isLast && <span>▶</span>}
                        <span className="font-semibold">{s.spaceName}</span>
                        {parts.length > 0 && (
                          <span className="text-indigo-500">· {parts.join(" · ")}</span>
                        )}
                      </button>
                    );
                  })}
                  {sessionSummary.spaceSummary.length > 5 && (
                    <span className="inline-flex items-center rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-xs text-indigo-500">
                      +{sessionSummary.spaceSummary.length - 5} mais
                    </span>
                  )}
                </div>

                {/* Botão de retomar a última sala */}
                {sessionSummary.lastVisitedSpaceId && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/room/${sessionSummary.lastVisitedSpaceId}`)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                    >
                      ▶ Retomar: {sessionSummary.lastVisitedSpaceName}
                    </button>
                  </div>
                )}
              </div>

              {/* Fechar */}
              <button
                type="button"
                onClick={() => {
                  setSessionBannerOpen(false);
                  setSessionSummary(null);
                  localStorage.removeItem("previousSessionAt");
                }}
                className="mt-0.5 shrink-0 rounded-md p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700 transition"
                aria-label="Fechar resumo de sessão"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Strategic panel moved to its own tab (Acompanhamento) */}

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="hidden sm:block">
            <nav className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                {visibleTabs.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => tab.id === "estrategico" ? router.push("/dashboard/estrategico") : setActiveTab(tab.id)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/ajuda")}
                  className="rounded-lg bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 transition hover:bg-sky-100"
                >
                  Ajuda
                </button>
              </div>
              {hasAuditAccess ? (
                <div className="relative ml-auto">
                  <button
                    type="button"
                    onClick={() => setAdminMenuOpen((open) => !open)}
                    aria-expanded={adminMenuOpen}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Administração
                  </button>
                  {adminMenuOpen ? (
                    <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                      <button
                        type="button"
                        onClick={() => router.push("/dashboard/movimentacoes")}
                        className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Movimentações
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push("/dashboard/estrategico")}
                        className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Acompanhamento
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push("/admin/unfound-items")}
                        className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Auditoria
                      </button>
                      {isInventoryAdmin ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("usuarios");
                              setAdminMenuOpen(false);
                            }}
                            className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Usuários
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              router.push("/admin/dados");
                              setAdminMenuOpen(false);
                            }}
                            className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Dados
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("backups");
                              setAdminMenuOpen(false);
                            }}
                            className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Backups
                          </button>
                        </>
                      ) : null}
                      {user?.role === "ADMIN" ? (
                        <button
                          type="button"
                          onClick={() => router.push("/admin/event-log")}
                          className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Relatório de Eventos
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </nav>
          </div>

          <div className="sm:hidden">
            <label
              htmlFor="dashboard-main-tab-select"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Navegação
            </label>
            <select
              id="dashboard-main-tab-select"
              value={activeTab}
              onChange={(event) => {
                  if (event.target.value === "estrategico") { router.push("/dashboard/estrategico"); }
                  else if (event.target.value === "ajuda") { router.push("/dashboard/ajuda"); }
                  else { setActiveTab(event.target.value); }
                }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {visibleTabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.label}
                </option>
              ))}
              <option value="ajuda">Ajuda</option>
            </select>
            <button
              type="button"
              onClick={() => router.push("/dashboard/ajuda")}
              className="mt-3 w-full rounded-lg bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 transition hover:bg-sky-100"
            >
              Ajuda operacional
            </button>
            {hasAuditAccess ? (
              <details className="mt-3 rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-slate-700">
                  Administração
                </summary>
                <div className="border-t border-slate-100 py-1">
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/movimentacoes")}
                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Movimentações
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/estrategico")}
                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Acompanhamento
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/admin/unfound-items")}
                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Auditoria
                </button>
                {isInventoryAdmin ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveTab("usuarios")}
                      className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Usuários
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/admin/dados")}
                      className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Dados
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("backups")}
                      className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Backups
                    </button>
                  </>
                ) : null}
                {user?.role === "ADMIN" ? (
                  <button
                    type="button"
                    onClick={() => router.push("/admin/event-log")}
                    className="block w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Relatório de Eventos
                  </button>
                ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </div>

        {activeTab === "espacos" ? (
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full lg:max-w-2xl">
              <SpaceSearchBar placeholder="Buscar espaços por nome..." />
            </div>
            {canManageSpaces ? (
              <div className="lg:flex lg:justify-end">
                <button
                  type="button"
                  onClick={openCreateSpaceModal}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  📝 Novo espaço
                </button>
              </div>
            ) : null}
          </div>
        ) : null}


        {activeTab === "espacos" && sortedSpaces.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-12 text-center">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              Nenhum espaço disponível
            </h3>
            <p className="text-gray-500">
              Não há espaços ativos para conferência no momento.
            </p>
          </div>
        ) : activeTab === "espacos" ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sortedSpaces.map((space) => {
              const phaseBadges = getSpacePhaseBadges(space);
              const phase = getSpacePhase(space);
              const phaseStyle = SPACE_PHASE_STYLES[phase];
              const isDeactivated = space.isActive === false;
              const displaySpaceName = isDeactivated
                ? `DESATIVADO - ${space.name}`
                : space.name;
              return (
                <div
                  key={space.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!isDeactivated) router.push(`/room/${space.id}`);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!isDeactivated) router.push(`/room/${space.id}`);
                    }
                  }}
                  className={`group relative block overflow-hidden rounded-xl border shadow-md transition-all duration-300 ${
                    isDeactivated
                      ? "cursor-default"
                      : "cursor-pointer hover:shadow-xl"
                  } ${phaseStyle.card}`}
                >
                  {canManageSpaces ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditSpaceModal(space);
                      }}
                      className="absolute left-3 top-3 z-10 rounded-full bg-white/95 px-3 py-2 text-sm font-semibold text-slate-700 opacity-0 shadow-md transition hover:bg-slate-50 group-hover:opacity-100"
                      aria-label={`Editar espaço ${displaySpaceName}`}
                      title="Editar nome"
                    >
                      ✏️
                    </button>
                  ) : null}
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className={`font-bold text-lg text-gray-900 transition line-clamp-2 ${phaseStyle.title}`}>
                        {displaySpaceName}
                      </h3>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                        {space.itemCount}{" "}
                        {space.itemCount === 1 ? "item" : "itens"}
                      </span>
                    </div>

                    <div className="mb-4 flex flex-col gap-1">
                      {phaseBadges.map((badge, i) => (
                        <span
                          key={i}
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>

                    <div className="space-y-2 mb-6">
                      <div className="flex items-center text-sm text-gray-600">
                        <span className="font-medium mr-2">👤</span>
                        <span className="truncate">
                          {space.responsible || "Não informado"}
                        </span>
                      </div>
                    </div>

                    <div className={`flex items-center justify-between gap-3 pt-4 border-t ${phaseStyle.footerBorder}`}>
                      {isDeactivated ? (
                        <>
                          <span className="text-sm text-zinc-500">
                            Invisível para usuários
                          </span>
                          {isInventoryAdmin ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleReactivateSpace(space);
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                            >
                              Reativar
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-gray-500">
                            Clique para conferir
                          </span>
                          <span className={`inline-flex items-center font-medium group-hover:translate-x-1 transition-transform ${phaseStyle.arrow}`}>
                            {space.isFinalized ? "Visualizar" : "Iniciar"}
                            <svg
                              className="w-4 h-4 ml-1"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </span>
                        </>
                      )}
                    </div>
                    {isInventoryAdmin && !isDeactivated && space.itemCount === 0 ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeactivateSpace(space);
                          }}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          Desativar espaço vazio
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {activeTab === "criar-grupos" ? (
          <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {/* Sub-abas */}
            <div className="mb-5 flex gap-2 border-b border-slate-200 pb-3">
              <button
                type="button"
                onClick={() => setGroupSubTab("itens")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  groupSubTab === "itens"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Itens
              </button>
              <button
                type="button"
                onClick={() => setGroupSubTab("grupos-criados")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  groupSubTab === "grupos-criados"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Grupos Criados
                {itemGroups.length > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      groupSubTab === "grupos-criados"
                        ? "bg-white/20 text-white"
                        : "bg-slate-300 text-slate-700"
                    }`}
                  >
                    {itemGroups.length}
                  </span>
                )}
              </button>
            </div>

            {/* Sub-aba: Itens */}
            {groupSubTab === "itens" && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Criar grupo de itens
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Selecione os itens que deseja agrupar. Itens serão
                      listados agrupados pela descrição e patrimônio.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedItems.size > 0) {
                        const selected = allItems.filter((i) =>
                          selectedItems.has(i.id),
                        );
                        const descs = [
                          ...new Set(
                            selected.map((i) => i.descricao).filter(Boolean),
                          ),
                        ];
                        if (descs.length === 1) setNewGroupName(descs[0]);
                        setGroupCreationModal(true);
                      } else {
                        showToast({
                          type: "error",
                          title: "Nenhum item selecionado",
                          message:
                            "Selecione pelo menos um item para criar um grupo.",
                        });
                      }
                    }}
                    disabled={selectedItems.size === 0 || creatingGroup}
                    className="whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {creatingGroup
                      ? "Criando..."
                      : `Criar Grupo (${selectedItems.size})`}
                  </button>
                </div>

                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Buscar por patrimônio, descrição ou localização..."
                  className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />

                {loadingItems ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Carregando itens...
                  </p>
                ) : Object.keys(filteredGroupedItems).length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    {itemSearch.trim()
                      ? "Nenhum item encontrado para a busca."
                      : "Nenhum item disponível no inventário."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const allFilteredIds = Object.values(filteredGroupedItems)
                        .flat()
                        .map((i) => i.id);
                      const allSelected =
                        allFilteredIds.length > 0 &&
                        allFilteredIds.every((id) => selectedItems.has(id));
                      const someSelected = allFilteredIds.some((id) =>
                        selectedItems.has(id),
                      );
                      return (
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el)
                                el.indeterminate = someSelected && !allSelected;
                            }}
                            onChange={() => {
                              setSelectedItems((prev) => {
                                const next = new Set(prev);
                                if (allSelected) {
                                  allFilteredIds.forEach((id) =>
                                    next.delete(id),
                                  );
                                } else {
                                  allFilteredIds.forEach((id) => next.add(id));
                                }
                                return next;
                              });
                            }}
                          />
                          Selecionar todos ({allFilteredIds.length})
                        </label>
                      );
                    })()}
                    {Object.entries(filteredGroupedItems)
                      .sort((a, b) => b[1].length - a[1].length)
                      .map(([descricao, items]) => {
                        const firstPatrimonio =
                          parseInt(items[0]?.patrimonio) || 0;
                        const lastPatrimonio =
                          parseInt(items[items.length - 1]?.patrimonio) || 0;
                        const isExpanded = expandedGroups[descricao];
                        const groupIds = items.map((i) => i.id);
                        const groupAllSelected = groupIds.every((id) =>
                          selectedItems.has(id),
                        );
                        const groupSomeSelected = groupIds.some((id) =>
                          selectedItems.has(id),
                        );

                        return (
                          <div
                            key={descricao}
                            className="rounded-lg border border-slate-200 bg-slate-50"
                          >
                            <div className="flex items-center px-4 py-3 hover:bg-slate-100">
                              <input
                                type="checkbox"
                                checked={groupAllSelected}
                                ref={(el) => {
                                  if (el)
                                    el.indeterminate =
                                      groupSomeSelected && !groupAllSelected;
                                }}
                                onChange={() => {
                                  setSelectedItems((prev) => {
                                    const next = new Set(prev);
                                    if (groupAllSelected) {
                                      groupIds.forEach((id) => next.delete(id));
                                    } else {
                                      groupIds.forEach((id) => next.add(id));
                                    }
                                    return next;
                                  });
                                }}
                                className="mr-3 shrink-0"
                              />
                              <button
                                onClick={() =>
                                  setExpandedGroups((prev) => ({
                                    ...prev,
                                    [descricao]: !prev[descricao],
                                  }))
                                }
                                className="flex flex-1 items-center justify-between gap-2 text-left"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-slate-600">
                                      {isExpanded ? "▼" : "▶"}
                                    </span>
                                    <span className="font-semibold text-slate-900">
                                      {descricao}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-600">
                                    Patrimônio #{firstPatrimonio} a #
                                    {lastPatrimonio} • {items.length} unidade(s)
                                  </p>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                                  {
                                    groupIds.filter((id) =>
                                      selectedItems.has(id),
                                    ).length
                                  }
                                  /{items.length}
                                </span>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="border-t border-slate-200 bg-white">
                                <div className="max-h-72 space-y-1 overflow-y-auto p-3">
                                  {items.map((item) => {
                                    const isSealed = item.space?.isFinalized;
                                    const isRevisorVerified =
                                      item.space?.isVerifiedByRevisor;
                                    return (
                                      <label
                                        key={item.id}
                                        className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${
                                          isRevisorVerified
                                            ? "bg-purple-50 hover:bg-purple-100"
                                            : isSealed
                                              ? "bg-purple-50/60 hover:bg-purple-100/60"
                                              : "hover:bg-slate-50"
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={selectedItems.has(item.id)}
                                          onChange={() =>
                                            !isSealed &&
                                            handleToggleItemSelection(item.id)
                                          }
                                          disabled={isSealed}
                                          className="mt-1 disabled:opacity-40"
                                        />
                                        <div className="flex-1 text-sm">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <p
                                              className={`font-medium ${isSealed ? "text-purple-900" : "text-slate-900"}`}
                                            >
                                              #{item.patrimonio}
                                            </p>
                                            {isSealed && (
                                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                                                🔒{" "}
                                                {isRevisorVerified
                                                  ? "Revisado — sala lacrada"
                                                  : "Sala lacrada"}
                                              </span>
                                            )}
                                          </div>
                                          <p
                                            className={`text-xs ${isSealed ? "text-purple-600" : "text-slate-600"}`}
                                          >
                                            {item.space?.name} •{" "}
                                            {item.condicaoVisual}
                                          </p>
                                          {isSealed && (
                                            <p className="mt-0.5 text-xs text-purple-500">
                                              Para mover este item, a sala
                                              precisa ser reaberta pelo
                                              administrador.
                                            </p>
                                          )}
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {/* Sub-aba: Grupos Criados */}
            {groupSubTab === "grupos-criados" && (
              <div className="rounded-xl border border-slate-200 p-4">
                {loadingGroups ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Carregando grupos...
                  </p>
                ) : itemGroups.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Nenhum grupo criado ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {itemGroups.map((group) => {
                      const isOpen = expandedCreatedGroups[group.id];
                      const found = group.items.filter(
                        (i) => i.statusEncontrado === "SIM",
                      ).length;
                      return (
                        <div
                          key={group.id}
                          className="rounded-lg border border-slate-200 bg-slate-50"
                        >
                          <div className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                            <div
                              className="flex-1 cursor-pointer hover:opacity-80"
                              onClick={() =>
                                setExpandedCreatedGroups((prev) => ({
                                  ...prev,
                                  [group.id]: !prev[group.id],
                                }))
                              }
                            >
                              <p className="font-semibold text-slate-900">
                                {group.name}
                              </p>
                              {group.description && (
                                <p className="text-xs text-slate-500">
                                  {group.description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">
                                {found}/{group.items.length} encontrado(s)
                              </span>
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  found === group.items.length &&
                                  group.items.length > 0
                                    ? "bg-emerald-500"
                                    : found > 0
                                      ? "bg-amber-400"
                                      : "bg-rose-400"
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => { setEditGroupModal(group); setEditGroupName(group.name); setEditGroupDesc(group.description || ""); }}
                                className="rounded px-2 py-1 text-xs text-slate-600 border border-slate-300 hover:bg-slate-100"
                                title="Renomear"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                disabled={group.items.length < 2}
                                onClick={() => { setSplitGroupModal(group); setSplitGroupSelected(new Set()); setSplitGroupNewName(""); }}
                                className="rounded px-2 py-1 text-xs text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-40"
                                title="Dividir grupo"
                              >
                                ✂️
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteGroupModal(group)}
                                className="rounded px-2 py-1 text-xs text-red-700 border border-red-300 bg-red-50 hover:bg-red-100"
                                title="Excluir grupo"
                              >
                                🗑
                              </button>
                              <span
                                className="text-xs font-semibold text-slate-500 ml-1 cursor-pointer"
                                onClick={() =>
                                  setExpandedCreatedGroups((prev) => ({
                                    ...prev,
                                    [group.id]: !prev[group.id],
                                  }))
                                }
                              >
                                {isOpen ? "▲" : "▼"}
                              </span>
                            </div>
                          </div>

                          {isOpen && (
                            <div className="border-t border-slate-200 bg-white">
                              {group.items.length === 0 ? (
                                <p className="px-4 py-3 text-xs text-slate-500">
                                  Sem itens.
                                </p>
                              ) : (
                                <div className="divide-y divide-slate-100">
                                  {group.items.map((item) => (
                                    <div
                                      key={item.id}
                                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                                    >
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-900">
                                          #{item.patrimonio}
                                        </p>
                                        <p className="truncate text-xs text-slate-500">
                                          {item.descricao}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 flex-col items-end gap-1">
                                        <span className="text-xs text-slate-600">
                                          {item.space?.name ||
                                            "Sem localização"}
                                        </span>
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                            item.statusEncontrado === "SIM"
                                              ? "bg-emerald-100 text-emerald-700"
                                              : item.statusEncontrado === "NAO"
                                                ? "bg-rose-100 text-rose-700"
                                                : "bg-amber-100 text-amber-700"
                                          }`}
                                        >
                                          {item.statusEncontrado === "SIM"
                                            ? "Encontrado"
                                            : item.statusEncontrado === "NAO"
                                              ? "Não localizado"
                                              : "Pendente"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        ) : activeTab === "duplicatas" ? (
          <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-800">⚠️ Duplicatas suspeitas</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Itens sinalizados pelos conferentes como possíveis duplicatas. Revise e decida a ação.
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadDuplicates(localStorage.getItem("token"))}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                ↻ Atualizar
              </button>
            </div>

            {/* Filtros */}
            {!duplicatesLoading && duplicateItems.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                <input
                  type="text"
                  value={dupSearch}
                  onChange={(e) => setDupSearch(e.target.value)}
                  placeholder="Buscar patrimônio, descrição ou sala…"
                  className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                <select
                  value={dupFilterRoom}
                  onChange={(e) => setDupFilterRoom(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
                >
                  <option value="">Todas as salas</option>
                  {dupRooms.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  value={dupFilterStatus}
                  onChange={(e) => setDupFilterStatus(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
                >
                  <option value="">Todos os status</option>
                  <option value="SIM">Encontrado</option>
                  <option value="NAO">Não localizado</option>
                  <option value="PENDENTE">Pendente</option>
                </select>
                <button
                  type="button"
                  onClick={() => setDupGroupByRoom((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                    dupGroupByRoom
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  🗂 Agrupar por sala
                </button>
                {(dupSearch || dupFilterRoom || dupFilterStatus) && (
                  <button
                    type="button"
                    onClick={() => { setDupSearch(""); setDupFilterRoom(""); setDupFilterStatus(""); }}
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                  >
                    ✕ Limpar filtros
                  </button>
                )}
                <span className="text-xs text-slate-400 ml-auto">
                  {filteredDupItems.length} de {duplicateItems.length} item{duplicateItems.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}

            {duplicatesLoading ? (
              <p className="py-10 text-center text-sm text-slate-500 animate-pulse">Carregando…</p>
            ) : duplicateItems.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <p className="text-3xl mb-2">✅</p>
                <p className="text-sm">Nenhuma duplicata suspeita no momento.</p>
              </div>
            ) : filteredDupItems.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                <p className="text-sm">Nenhum item corresponde aos filtros selecionados.</p>
              </div>
            ) : dupGrouped ? (
              <div className="space-y-4">
                {dupGrouped.map(([roomName, roomItems]) => (
                  <div key={roomName} className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2.5 flex items-center gap-2 border-b border-slate-200">
                      <span className="font-semibold text-sm text-slate-800">📍 {roomName}</span>
                      <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium">
                        {roomItems.length} item{roomItems.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {roomItems.map((item) => (
                        <DupItemCard key={item.id} item={item} onResolve={handleResolveDuplicate} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredDupItems.map((item) => (
                  <DupItemCard key={item.id} item={item} onResolve={handleResolveDuplicate} />
                ))}
              </div>
            )}
          </section>
        ) : activeTab === "nao-localizados" ? (
          <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {/* Sub-abas */}
            <div className="mb-5 flex gap-2 border-b border-slate-200 pb-3">
              <button
                type="button"
                onClick={() => setUnfoundSubTab("itens")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  unfoundSubTab === "itens"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Itens Não Localizados
              </button>
              <button
                type="button"
                onClick={() => setUnfoundSubTab("historico")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  unfoundSubTab === "historico"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Histórico
                {unfoundItems.length > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      unfoundSubTab === "historico"
                        ? "bg-white/20 text-white"
                        : "bg-slate-300 text-slate-700"
                    }`}
                  >
                    {unfoundItems.length}
                  </span>
                )}
              </button>
            </div>

            {/* Sub-aba: Itens Não Localizados */}
            {unfoundSubTab === "itens" && (
              <div className="rounded-xl border border-slate-200 p-4">
                {/* Filtros */}
                {!unfoundLoading && unfoundItems.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      value={unfoundSearch}
                      onChange={(e) => setUnfoundSearch(e.target.value)}
                      placeholder="Buscar patrimônio, descrição ou sala…"
                      className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <select
                      value={unfoundFilterRoom}
                      onChange={(e) => setUnfoundFilterRoom(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
                    >
                      <option value="">Todas as salas</option>
                      {unfoundRooms.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setUnfoundGroupByRoom((v) => !v)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                        unfoundGroupByRoom
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      🗂 Agrupar por sala
                    </button>
                    {(unfoundSearch || unfoundFilterRoom) && (
                      <button
                        type="button"
                        onClick={() => { setUnfoundSearch(""); setUnfoundFilterRoom(""); }}
                        className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                      >
                        ✕ Limpar filtros
                      </button>
                    )}
                    <span className="text-xs text-slate-400 ml-auto">
                      {filteredUnfoundItems.length} de {unfoundItems.length} item{unfoundItems.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}

                {unfoundLoading ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Carregando itens não localizados...
                  </p>
                ) : unfoundItems.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-2">✓</div>
                    <p className="text-slate-600 font-medium">
                      Todos os itens foram localizados!
                    </p>
                  </div>
                ) : filteredUnfoundItems.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">
                    <p className="text-sm">Nenhum item corresponde aos filtros selecionados.</p>
                  </div>
                ) : unfoundGrouped ? (
                  <div className="space-y-4">
                    {unfoundGrouped.map(([roomName, roomItems]) => (
                      <div key={roomName} className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2.5 flex items-center gap-2 border-b border-slate-200">
                          <span className="font-semibold text-sm text-slate-800">📍 {roomName}</span>
                          <span className="text-xs px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full font-medium">
                            {roomItems.length} item{roomItems.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <UnfoundItemsTable
                          items={roomItems}
                          sorts={unfoundSorts}
                          onSort={handleUnfoundSort}
                          expandedItems={expandedUnfoundItems}
                          onToggleItem={(itemId) => setExpandedUnfoundItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }))}
                          onMoveItem={(item) => { setUnfoundCondicao("BOM"); setUnfoundMoveTargetSpaceId(""); setUnfoundActionModal({ item, action: "mover" }); }}
                          abbreviateName={abbreviateName}
                          fmtDate={fmtDate}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <UnfoundItemsTable
                    items={sortedUnfoundItems}
                    sorts={unfoundSorts}
                    onSort={handleUnfoundSort}
                    expandedItems={expandedUnfoundItems}
                    onToggleItem={(itemId) => setExpandedUnfoundItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }))}
                    onMoveItem={(item) => { setUnfoundCondicao("BOM"); setUnfoundMoveTargetSpaceId(""); setUnfoundActionModal({ item, action: "mover" }); }}
                    abbreviateName={abbreviateName}
                    fmtDate={fmtDate}
                  />
                )}
              </div>
            )}

            {/* Sub-aba: Histórico */}
            {unfoundSubTab === "historico" && (
              <div className="rounded-xl border border-slate-200 p-4">
                {unfoundLoading ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Carregando histórico...
                  </p>
                ) : unfoundItems.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Nenhum histórico de itens não localizados.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="px-3 py-2">Patrimônio</th>
                          <th className="px-3 py-2">Descrição</th>
                          <th className="px-3 py-2">Marcado por</th>
                          <th className="px-3 py-2">Data/Hora</th>
                          <th className="px-3 py-2">Localização</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unfoundItems.map((item, index) => (
                          <tr key={index} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-medium text-slate-900">
                              #{item.patrimonio || "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-xs">
                              {item.descricao || "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 text-xs">
                              {item.marcadoPorQuem || "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 text-xs">
                              {item.marcadoEm
                                ? new Date(item.marcadoEm).toLocaleString(
                                    "pt-BR",
                                  )
                                : item.dataUltimaAlteracao
                                  ? new Date(
                                      item.dataUltimaAlteracao,
                                    ).toLocaleString("pt-BR")
                                  : "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 text-xs">
                              {item.ultimoLocalConhecido || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : activeTab !== "espacos" ? (
          <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {isInventoryAdmin ? (
              <div className="min-w-0 rounded-xl border border-slate-200 p-4">
                {activeTab === "usuarios" ? (
                  <div>
                    <div className="mb-6 rounded-xl border border-slate-200 p-4">
                      <p className="mb-3 text-sm font-semibold text-slate-800">
                        Buscar usuário para incluir
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Digite nome, siape ou cpf"
                          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <select
                          value={newMemberRole}
                          onChange={(e) => setNewMemberRole(e.target.value)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          {INVENTORY_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleSearchUsers}
                          disabled={searchingUsers}
                          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                        >
                          {searchingUsers ? "Buscando..." : "Buscar"}
                        </button>
                      </div>

                      {searchResults.length > 0 ? (
                        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-700">
                              <tr>
                                <th className="px-3 py-2">Usuário</th>
                                <th className="px-3 py-2">Situação</th>
                                <th className="px-3 py-2">Ação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {searchResults.map((result) => (
                                <tr
                                  key={result.samAccountName}
                                  className="border-t border-slate-100"
                                >
                                  <td className="px-3 py-2">
                                    <p className="font-medium text-slate-900">
                                      {result.samAccountName} -{" "}
                                      {result.givenName ||
                                        result.fullName?.split(" ")[0] ||
                                        result.fullName}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-slate-600">
                                    {result.alreadyLinked
                                      ? `Já vinculado (${result.inventoryRole})`
                                      : result.existsLocally
                                        ? "Encontrado no banco local"
                                        : "Encontrado no AD"}
                                  </td>
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={() =>
                                        handleAddPermission(result)
                                      }
                                      className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                                    >
                                      {result.alreadyLinked
                                        ? "Atualizar perfil"
                                        : "Adicionar"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <p className="mb-3 text-sm font-semibold text-slate-800">
                        Usuários autorizados
                      </p>
                      {permissionsLoading ? (
                        <p className="text-sm text-slate-600">
                          Carregando membros...
                        </p>
                      ) : members.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          Nenhum usuário vinculado.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-700">
                              <tr>
                                <th className="px-3 py-2">Usuário</th>
                                <th className="px-3 py-2">Perfil</th>
                                <th className="px-3 py-2">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {members.map((member) => (
                                <tr
                                  key={member.userId}
                                  className="border-t border-slate-100"
                                >
                                  <td className="px-3 py-2">
                                    <p className="font-medium text-slate-900">
                                      {member.samAccountName} -{" "}
                                      {member.fullName?.split(" ")[0] ||
                                        member.fullName}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2">
                                    <select
                                      value={member.inventoryRole}
                                      onChange={(e) =>
                                        handleUpdatePermission(
                                          member,
                                          e.target.value,
                                        )
                                      }
                                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                                    >
                                      {INVENTORY_ROLES.map((role) => (
                                        <option key={role} value={role}>
                                          {role}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={() =>
                                        handleRemovePermission(member)
                                      }
                                      className="rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                                    >
                                      Remover
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activeTab === "dados" ? (
                  <div className="space-y-6">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="mb-3 text-sm font-semibold text-slate-800">
                        Metadados do inventário
                      </p>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-sm text-slate-700">
                          Nome do inventário
                          <input
                            value={inventoryNameDraft}
                            onChange={(event) =>
                              setInventoryNameDraft(event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          Situação operacional
                          <select
                            value={inventoryStatusDraft}
                            onChange={(event) =>
                              setInventoryStatusDraft(event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            {INVENTORY_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {STATUS_LABELS[status]}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="text-sm text-slate-700">
                          Responsável principal
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.owner
                              ? `${inventoryDetails.owner.samAccountName} - ${inventoryDetails.owner.fullName?.split(" ")[0] || inventoryDetails.owner.fullName}`
                              : "Não informado"}
                          </p>
                        </div>

                        <div className="text-sm text-slate-700">
                          Fonte de dados
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.sourceType || "Não informado"}
                          </p>
                        </div>

                        <div className="text-sm text-slate-700">
                          Data de início
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.startedAt
                              ? new Date(
                                  inventoryDetails.startedAt,
                                ).toLocaleDateString("pt-BR")
                              : "Não definida"}
                          </p>
                        </div>

                        <div className="text-sm text-slate-700">
                          Data de término
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.finishedAt
                              ? new Date(
                                  inventoryDetails.finishedAt,
                                ).toLocaleDateString("pt-BR")
                              : "Não definida"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={handleSaveInventorySettings}
                          disabled={savingInventorySettings}
                          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          {savingInventorySettings
                            ? "Salvando..."
                            : "Salvar dados"}
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-semibold text-slate-800">
                        Histórico de status
                      </p>
                      {loadingStatusHistory ? (
                        <p className="text-sm text-slate-600">
                          Carregando histórico...
                        </p>
                      ) : statusHistory.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          Nenhuma mudança de status registrada.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-700">
                              <tr>
                                <th className="px-3 py-2">Transição</th>
                                <th className="px-3 py-2">Usuário</th>
                                <th className="px-3 py-2">Data/Hora</th>
                              </tr>
                            </thead>
                            <tbody>
                              {statusHistory.map((entry) => (
                                <tr
                                  key={entry.id}
                                  className="border-t border-slate-100"
                                >
                                  <td className="px-3 py-2 text-xs text-slate-700">
                                    {STATUS_LABELS[entry.fromStatus] ||
                                      entry.fromStatus}
                                    {" -> "}
                                    {STATUS_LABELS[entry.toStatus] ||
                                      entry.toStatus}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-slate-600">
                                    {entry.changedBy}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-slate-600">
                                    {new Date(entry.changedAt).toLocaleString(
                                      "pt-BR",
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activeTab === "backups" ? (
                  <div className="space-y-6">

                    {/* Inventory selector — only shown when the user manages more than one inventory */}
                    {backupInventories.length > 1 && (
                      <div className="rounded-xl border border-slate-200 p-5">
                        <h3 className="text-sm font-semibold text-slate-800 mb-3">📦 Inventário</h3>
                        <select
                          value={backupSelectedInventoryId || ""}
                          onChange={(e) => {
                            setBackupList([]);
                            setBackupSchedule(null);
                            setBackupLockStatus(null);
                            setBackupSelectedInventoryId(e.target.value);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        >
                          {backupInventories.map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.name}{inv.campus ? ` — ${inv.campus}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Lock status banner */}
                    {backupLockStatus?.locked && (
                      <div className="flex items-center gap-3 rounded-xl border border-orange-300 bg-orange-50 p-4">
                        <span className="text-xl">🔒</span>
                        <div>
                          <p className="text-sm font-semibold text-orange-900">
                            Sistema bloqueado — {backupLockStatus.lock?.reason === "BACKUP" ? "Backup" : "Restauração"} em andamento
                          </p>
                          <p className="text-xs text-orange-700 mt-0.5">
                            Alterações no inventário estão temporariamente bloqueadas. Aguarde a conclusão.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Manual backup */}
                    <div className="rounded-xl border border-slate-200 p-5">
                      <h3 className="text-sm font-semibold text-slate-800 mb-1">🗄️ Criar backup manual</h3>
                      <p className="text-xs text-slate-500 mb-4">
                        Gera um arquivo SQL com o estado atual do inventário. O sistema ficará bloqueado para alterações durante a geração.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={backupLabelInput}
                          onChange={(e) => setBackupLabelInput(e.target.value)}
                          placeholder="Descrição opcional (ex: antes da auditoria)"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                        <button
                          type="button"
                          onClick={handleCreateBackup}
                          disabled={backupLoading || backupLockStatus?.locked}
                          className="shrink-0 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                        >
                          {backupLoading ? "Gerando..." : "Gerar backup"}
                        </button>
                      </div>
                    </div>

                    {/* Scheduled backup */}
                    <div className="rounded-xl border border-slate-200 p-5">
                      <h3 className="text-sm font-semibold text-slate-800 mb-1">🕒 Backup automático</h3>
                      <p className="text-xs text-slate-500 mb-4">
                        O sistema criará backups automaticamente no intervalo configurado.
                      </p>
                      {backupSchedule ? (
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 mb-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-emerald-800">
                              ✅ Ativo — a cada {backupSchedule.intervalHours}h
                            </p>
                            <p className="text-xs text-emerald-700 mt-0.5">
                              Último: {backupSchedule.lastRunAt ? fmtDateTime(backupSchedule.lastRunAt) : "ainda não executou"} •{" "}
                              Próximo: {fmtDateTime(backupSchedule.nextRunAt)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleDeleteSchedule}
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            Desativar
                          </button>
                        </div>
                      ) : null}
                      <div className="flex gap-2 items-center">
                        <input
                          type="number"
                          min="1"
                          value={scheduleIntervalInput}
                          onChange={(e) => setScheduleIntervalInput(e.target.value)}
                          placeholder="Intervalo em horas (ex: 12)"
                          className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                        <button
                          type="button"
                          onClick={handleSaveSchedule}
                          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                        >
                          {backupSchedule ? "Atualizar intervalo" : "Ativar agendamento"}
                        </button>
                      </div>
                    </div>

                    {/* Backup list */}
                    <div className="rounded-xl border border-slate-200 p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-slate-800">📋 Backups realizados</h3>
                        <button
                          type="button"
                          onClick={loadBackupData}
                          className="text-xs text-sky-600 hover:underline"
                        >
                          Atualizar
                        </button>
                      </div>

                      {backupListLoading ? (
                        <p className="text-sm text-slate-400">Carregando...</p>
                      ) : backupList.length === 0 ? (
                        <p className="text-sm text-slate-400">Nenhum backup encontrado.</p>
                      ) : (
                        <div className="overflow-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                                <th className="pb-2 pr-4">Data / Hora</th>
                                <th className="pb-2 pr-4">Descrição</th>
                                <th className="pb-2 pr-4">Criado por</th>
                                <th className="pb-2 pr-4">Tamanho</th>
                                <th className="pb-2 pr-4">Tipo</th>
                                <th className="pb-2 pr-4">Status</th>
                                <th className="pb-2">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {backupList.map((record) => (
                                <tr key={record.id} className="align-middle">
                                  <td className="py-2.5 pr-4 whitespace-nowrap text-slate-700">
                                    {fmtDateTime(record.createdAt)}
                                  </td>
                                  <td className="py-2.5 pr-4 text-slate-600 max-w-[180px] truncate">
                                    {record.label || <span className="text-slate-400 italic">—</span>}
                                  </td>
                                  <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                                    {abbreviateName(record.createdBy)}
                                  </td>
                                  <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                                    {fmtBytes(record.fileSizeBytes)}
                                  </td>
                                  <td className="py-2.5 pr-4">
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${record.isScheduled ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}`}>
                                      {record.isScheduled ? "Automático" : "Manual"}
                                    </span>
                                  </td>
                                  <td className="py-2.5 pr-4">
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                      record.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700"
                                      : record.status === "FAILED" ? "bg-red-100 text-red-700"
                                      : "bg-amber-100 text-amber-700"
                                    }`}>
                                      {record.status === "COMPLETED" ? "✓ Concluído"
                                        : record.status === "FAILED" ? "✗ Falha"
                                        : "⏳ Em andamento"}
                                    </span>
                                  </td>
                                  <td className="py-2.5">
                                    <div className="flex gap-1.5">
                                      {record.status === "COMPLETED" && (
                                        <>
                                          <button
                                            type="button"
                                            title="Baixar SQL"
                                            onClick={() => handleDownloadBackup(record)}
                                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                          >
                                            ⬇ Baixar
                                          </button>
                                          <button
                                            type="button"
                                            title="Restaurar este backup"
                                            onClick={() => { setBackupRestoreId(record.id); setBackupConfirmAction("restore"); }}
                                            className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                                          >
                                            ↩ Restaurar
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        title="Excluir backup"
                                        onClick={() => { setBackupDeleteId(record.id); setBackupConfirmAction("delete"); }}
                                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                                      >
                                        🗑
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  Acesso restrito
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  A aba {activeTabMeta.label} está disponível apenas para
                  administradores do inventário (ADMIN_CICLO).
                </p>
              </div>
            )}
          </section>
        ) : null}
      </main>

      <Modal
        isOpen={Boolean(spaceModal)}
        onClose={closeSpaceModal}
        title={spaceModal?.mode === "edit" ? "Editar espaço" : "Novo espaço"}
        size="md"
      >
        <form onSubmit={submitSpaceModal}>
          <ModalBody>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Nome
                </label>
                <input
                  value={spaceForm.name}
                  onChange={(event) =>
                    setSpaceForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Nome do espaço"
                  required
                />
              </div>

              {spaceModal?.mode === "create" ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Responsável
                    </label>
                    <input
                      value={spaceForm.responsible}
                      onChange={(event) =>
                        setSpaceForm((prev) => ({
                          ...prev,
                          responsible: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Nome do responsável"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Setor
                      </label>
                      <input
                        value={spaceForm.sector}
                        onChange={(event) =>
                          setSpaceForm((prev) => ({
                            ...prev,
                            sector: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Opcional"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Unidade
                      </label>
                      <input
                        value={spaceForm.unit}
                        onChange={(event) =>
                          setSpaceForm((prev) => ({
                            ...prev,
                            unit: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              onClick={closeSpaceModal}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              {spaceModal?.mode === "edit" ? "Salvar mudanças" : "Criar espaço"}
            </button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        isOpen={groupCreationModal}
        onClose={() => {
          setGroupCreationModal(false);
          setNewGroupName("");
          setNewGroupDescription("");
        }}
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Nome do Grupo *
              </label>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Ex: Carteiras da Sala 101"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Descrição (opcional)
              </label>
              <textarea
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                placeholder="Descreva o propósito ou características do grupo..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows="3"
              />
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">
                Itens selecionados: {selectedItems.size}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Este grupo incluirá os {selectedItems.size} item(ns) que você
                selecionou.
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => {
              setGroupCreationModal(false);
              setNewGroupName("");
              setNewGroupDescription("");
            }}
            disabled={creatingGroup}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={creatingGroup || !newGroupName.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {creatingGroup ? "Criando grupo..." : "Criar Grupo"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Modal: renomear grupo */}
      <Modal
        isOpen={!!editGroupModal}
        onClose={() => setEditGroupModal(null)}
        title="Renomear grupo"
        size="sm"
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome</label>
              <input
                value={editGroupName}
                onChange={(e) => setEditGroupName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Descrição (opcional)</label>
              <input
                value={editGroupDesc}
                onChange={(e) => setEditGroupDesc(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setEditGroupModal(null)}
            disabled={savingEditGroup}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleEditGroup}
            disabled={savingEditGroup || !editGroupName.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {savingEditGroup ? "Salvando…" : "Salvar"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Modal: excluir grupo */}
      <Modal
        isOpen={!!deleteGroupModal}
        onClose={() => setDeleteGroupModal(null)}
        title="Excluir grupo"
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-slate-700">
            Excluir o grupo <strong>{deleteGroupModal?.name}</strong>? Os itens
            permanecem no sistema, apenas sem vínculo ao grupo.
          </p>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setDeleteGroupModal(null)}
            disabled={deletingGroup}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDeleteGroup}
            disabled={deletingGroup}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deletingGroup ? "Excluindo…" : "Excluir"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Modal: dividir grupo */}
      <Modal
        isOpen={!!splitGroupModal}
        onClose={() => setSplitGroupModal(null)}
        title="Dividir grupo"
        size="md"
      >
        <ModalBody>
          <p className="mb-3 text-sm text-slate-600">
            Selecione os itens que formarão o novo grupo. Os demais permanecem em{" "}
            <strong>{splitGroupModal?.name}</strong>.
          </p>
          <div className="mb-4 max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y">
            {splitGroupModal?.items.map((item) => (
              <label key={item.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 text-sm">
                <input
                  type="checkbox"
                  checked={splitGroupSelected.has(item.id)}
                  onChange={() => {
                    setSplitGroupSelected((prev) => {
                      const next = new Set(prev);
                      next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                      return next;
                    });
                  }}
                  className="rounded text-indigo-600"
                />
                <span className="font-mono text-slate-700">#{item.patrimonio || "—"}</span>
                <span className="text-slate-500 truncate">{item.descricao}</span>
              </label>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Nome do novo grupo</label>
            <input
              value={splitGroupNewName}
              onChange={(e) => setSplitGroupNewName(e.target.value)}
              placeholder="Nome para o subgrupo"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {splitGroupSelected.size} iten(s) selecionado(s) para o novo grupo.
          </p>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setSplitGroupModal(null)}
            disabled={splittingGroup}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSplitGroup}
            disabled={splittingGroup || splitGroupSelected.size === 0 || !splitGroupNewName.trim()}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {splittingGroup ? "Dividindo…" : "Dividir"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Modal para ação de item não localizado */}
      <Modal
        isOpen={!!unfoundActionModal}
        onClose={() => setUnfoundActionModal(null)}
        title="Mover item para outra sala"
        size="md"
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Item: #{unfoundActionModal?.item?.patrimonio}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                {unfoundActionModal?.item?.descricao}
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Sala de destino:
              </p>
              <select
                value={unfoundMoveTargetSpaceId}
                onChange={(e) => setUnfoundMoveTargetSpaceId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="">Selecione uma sala...</option>
                {spaces
                  .filter((s) => s.isActive !== false && !s.isFinalized)
                  .map((s) => {
                    const isOrigin = s.id === unfoundActionModal?.item?.ultimoLocalConhecidoId;
                    return (
                      <option key={s.id} value={s.id}>
                        {isOrigin ? `↩️ ${s.name} (desfazer — retornar ao local de origem)` : s.name}
                      </option>
                    );
                  })}
              </select>
            </div>

            {unfoundMoveTargetSpaceId === unfoundActionModal?.item?.ultimoLocalConhecidoId ? (
              <div className="rounded-lg bg-blue-50 p-3 border border-blue-200">
                <p className="text-xs text-blue-800 font-medium">
                  ↩️ O item voltará para pendente no local de origem — a marcação &quot;não localizado&quot; será desfeita.
                </p>
              </div>
            ) : unfoundMoveTargetSpaceId ? (
              <>
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-700">
                    Condição visual:
                  </p>
                  <div className="flex gap-2">
                    {[["BOM", "🟢 Bom"], ["REGULAR", "🟡 Regular"], ["RUIM", "🔴 Ruim"]].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setUnfoundCondicao(val)}
                        className={`flex-1 py-2 px-2 rounded-lg font-medium text-xs transition ${
                          unfoundCondicao === val
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 border border-amber-200">
                  <p className="text-xs text-amber-800">
                    O item será movido para a sala selecionada e ficará aguardando confirmação na sala de destino.
                  </p>
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-amber-50 p-3 border border-amber-200">
                <p className="text-xs text-amber-800">
                  O item será movido para a sala selecionada e ficará aguardando confirmação na sala de destino.
                </p>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setUnfoundActionModal(null)}
            disabled={savingUnfoundAction}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (unfoundActionModal?.item) {
                handleUnfoundItemAction(
                  unfoundActionModal.item,
                  unfoundActionModal.action,
                  unfoundCondicao,
                  unfoundMoveTargetSpaceId,
                );
              }
            }}
            disabled={savingUnfoundAction || !unfoundMoveTargetSpaceId}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingUnfoundAction
              ? "Processando..."
              : unfoundMoveTargetSpaceId === unfoundActionModal?.item?.ultimoLocalConhecidoId
              ? "↩️ Desfazer não localizado"
              : "Confirmar mover"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Backup confirmation modal (restore / delete) */}
      <Modal
        isOpen={!!backupConfirmAction}
        onClose={() => { setBackupConfirmAction(null); setBackupRestoreId(null); setBackupDeleteId(null); }}
        title={backupConfirmAction === "restore" ? "Confirmar restauração" : "Confirmar exclusão"}
        size="sm"
      >
        <ModalBody>
          {backupConfirmAction === "restore" ? (
            <div>
              <p className="text-sm text-slate-700 mb-3">
                <strong>Atenção:</strong> Esta operação irá <strong>substituir todos os dados atuais</strong> do inventário pelo conteúdo deste backup.
              </p>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 mb-3">
                <p className="text-xs text-blue-800 font-semibold">🛡️ Salvaguarda automática: antes de restaurar, o sistema criará automaticamente um backup do estado atual, garantindo que nenhum dado seja perdido sem possibilidade de recuperação.</p>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs text-amber-800 font-semibold">O sistema ficará bloqueado para alterações durante o processo de backup de segurança e restauração.</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-700">
              O arquivo SQL será excluído permanentemente e não poderá ser recuperado.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => { setBackupConfirmAction(null); setBackupRestoreId(null); setBackupDeleteId(null); }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (backupConfirmAction === "restore" && backupRestoreId) handleRestoreBackup(backupRestoreId);
              if (backupConfirmAction === "delete" && backupDeleteId) handleDeleteBackup(backupDeleteId);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${backupConfirmAction === "restore" ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"}`}
          >
            {backupConfirmAction === "restore" ? "Sim, restaurar" : "Sim, excluir"}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
