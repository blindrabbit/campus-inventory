"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../../components/Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function normalizeText(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getSpaceVisual(space) {
  if (!space) {
    return {
      label: "Sem sala",
      badge: "bg-slate-100 text-slate-700 ring-slate-200",
      row: "border-slate-100 bg-white hover:bg-slate-50",
      accent: "bg-slate-400",
    };
  }

  if (space.isVerified || space.isVerifiedByRevisor) {
    return {
      label: "Confirmada",
      badge: "bg-violet-100 text-violet-800 ring-violet-200",
      row: "border-violet-100 bg-violet-50/60 hover:bg-violet-50",
      accent: "bg-violet-500",
    };
  }

  if (space.isFinalized || space.executionStatus === "FINALIZADO") {
    return {
      label: "Lacrada",
      badge: "bg-emerald-100 text-emerald-800 ring-emerald-200",
      row: "border-emerald-100 bg-emerald-50/70 hover:bg-emerald-50",
      accent: "bg-emerald-500",
    };
  }

  if (space.startedAt || space.executionStatus === "INICIADO") {
    return {
      label: "Iniciada",
      badge: "bg-amber-100 text-amber-800 ring-amber-200",
      row: "border-amber-100 bg-amber-50/70 hover:bg-amber-50",
      accent: "bg-amber-500",
    };
  }

  return {
    label: "Não iniciada",
    badge: "bg-rose-100 text-rose-800 ring-rose-200",
    row: "border-rose-100 bg-rose-50/60 hover:bg-rose-50",
    accent: "bg-rose-500",
  };
}

function getItemStatusVisual(status) {
  if (status === "SIM") {
    return {
      label: "Encontrado",
      badge: "bg-sky-100 text-sky-800 ring-sky-200",
      row: "border-sky-100 bg-sky-50/50 hover:bg-sky-50",
    };
  }

  if (status === "NAO") {
    return {
      label: "Não localizado",
      badge: "bg-rose-100 text-rose-800 ring-rose-200",
      row: "border-rose-100 bg-rose-50/60 hover:bg-rose-50",
    };
  }

  return {
    label: "Pendente",
    badge: "bg-amber-100 text-amber-800 ring-amber-200",
    row: "border-amber-100 bg-amber-50/50 hover:bg-amber-50",
  };
}

function StatusBadge({ label, className }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${className}`}
    >
      {label}
    </span>
  );
}

export default function PlannedMovementsPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [inventoryId, setInventoryId] = useState("");
  const [user, setUser] = useState(null);
  const [activeInventory, setActiveInventory] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [itemResults, setItemResults] = useState([]);
  const [itemSearching, setItemSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [spaceSearch, setSpaceSearch] = useState("");
  const [targetSpaceId, setTargetSpaceId] = useState("");
  const [movements, setMovements] = useState([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = user?.role === "ADMIN" || activeInventory?.role === "ADMIN_CICLO";

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedInventoryId = localStorage.getItem("activeInventoryId");
    const storedUser = JSON.parse(localStorage.getItem("user") || "null");
    const storedInventory = JSON.parse(
      localStorage.getItem("activeInventory") || "null",
    );

    if (!storedToken) {
      router.push("/login");
      return;
    }

    if (!storedInventoryId) {
      router.push("/inventories");
      return;
    }

    setToken(storedToken);
    setInventoryId(storedInventoryId);
    setUser(storedUser);
    setActiveInventory({
      ...(storedInventory || {}),
      id: storedInventory?.id || storedInventoryId,
    });
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (loading) return;
    if (!isAdmin) {
      showToast({
        type: "error",
        title: "Acesso negado",
        message: "Apenas administradores do ciclo podem movimentar salas lacradas.",
      });
      router.push("/dashboard");
    }
  }, [isAdmin, loading, router, showToast]);

  useEffect(() => {
    if (!token || !inventoryId || !isAdmin) return;

    const loadSpaces = async () => {
      setSpacesLoading(true);
      try {
        const { data } = await axios.get(`${API}/spaces/active`, {
          params: { inventoryId, includeFinalized: true },
          headers: { Authorization: `Bearer ${token}` },
        });
        setSpaces(data);
      } catch (error) {
        showToast({
          type: "error",
          title: "Falha ao carregar salas",
          message:
            error.response?.data?.error ||
            "Não foi possível carregar as salas.",
        });
      } finally {
        setSpacesLoading(false);
      }
    };

    loadSpaces();
  }, [inventoryId, isAdmin, showToast, token]);

  useEffect(() => {
    if (!token || !inventoryId || itemSearch.trim().length < 2) {
      setItemResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setItemSearching(true);
      try {
        const { data } = await axios.get(`${API}/items/search`, {
          params: { inventoryId, q: itemSearch.trim() },
          headers: { Authorization: `Bearer ${token}` },
        });
        setItemResults(data);
      } catch (error) {
        setItemResults([]);
        showToast({
          type: "error",
          title: "Falha na busca",
          message:
            error.response?.data?.error ||
            "Não foi possível buscar patrimônios.",
        });
      } finally {
        setItemSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [inventoryId, itemSearch, showToast, token]);

  const selectedTargetSpace = useMemo(
    () => spaces.find((space) => space.id === targetSpaceId) || null,
    [spaces, targetSpaceId],
  );

  const spacesById = useMemo(
    () => new Map(spaces.map((space) => [space.id, space])),
    [spaces],
  );

  const filteredSpaces = useMemo(() => {
    const term = normalizeText(spaceSearch);
    return spaces
      .filter((space) => {
        if (!term) return true;
        return (
          normalizeText(space.name).includes(term) ||
          normalizeText(space.responsibleDisplay || space.responsible).includes(term) ||
          normalizeText(space.sector).includes(term) ||
          normalizeText(space.unit).includes(term)
        );
      })
      .sort((a, b) => {
        if (a.isFinalized !== b.isFinalized) return a.isFinalized ? 1 : -1;
        return (a.name || "").localeCompare(b.name || "", "pt-BR", {
          sensitivity: "base",
          numeric: true,
        });
      })
      .slice(0, 20);
  }, [spaceSearch, spaces]);

  const hasFinalizedSpace = useMemo(
    () =>
      movements.some(
        (movement) =>
          movement.sourceSpaceFinalized || movement.targetSpaceFinalized,
      ),
    [movements],
  );

  const canAddMovement =
    selectedItem &&
    selectedTargetSpace &&
    selectedItem.spaceId !== selectedTargetSpace.id &&
    !movements.some((movement) => movement.itemId === selectedItem.id);

  const addMovement = () => {
    if (!selectedItem || !selectedTargetSpace) return;

    if (selectedItem.spaceId === selectedTargetSpace.id) {
      showToast({
        type: "warning",
        title: "Destino igual à origem",
        message: "Escolha uma sala diferente da sala atual do patrimônio.",
      });
      return;
    }

    if (movements.some((movement) => movement.itemId === selectedItem.id)) {
      showToast({
        type: "warning",
        title: "Patrimônio já incluído",
        message: "Remova a linha existente antes de trocar o destino.",
      });
      return;
    }

    setMovements((current) => [
      ...current,
      {
        itemId: selectedItem.id,
        patrimonio: selectedItem.patrimonio,
        descricao: selectedItem.descricao,
        statusEncontrado: selectedItem.statusEncontrado,
        sourceSpaceId: selectedItem.spaceId,
        sourceSpaceName: selectedItem.spaceName,
        sourceSpaceFinalized: selectedItem.spaceIsFinalized,
        sourceSpace: spacesById.get(selectedItem.spaceId) || {
          id: selectedItem.spaceId,
          name: selectedItem.spaceName,
          isFinalized: selectedItem.spaceIsFinalized,
        },
        targetSpaceId: selectedTargetSpace.id,
        targetSpaceName: selectedTargetSpace.name,
        targetSpaceFinalized: selectedTargetSpace.isFinalized,
        targetSpace: selectedTargetSpace,
      },
    ]);
    setSelectedItem(null);
    setItemSearch("");
    setItemResults([]);
    setTargetSpaceId("");
    setSpaceSearch("");
  };

  const removeMovement = (itemId) => {
    setMovements((current) =>
      current.filter((movement) => movement.itemId !== itemId),
    );
  };

  const executeMovements = async () => {
    if (movements.length === 0) return;

    if (hasFinalizedSpace && !reason.trim()) {
      showToast({
        type: "warning",
        title: "Justificativa obrigatória",
        message: "Informe o motivo da movimentação envolvendo sala lacrada.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await axios.post(
        `${API}/items/planned-relocations`,
        {
          inventoryId,
          reason: reason.trim() || null,
          movements: movements.map((movement) => ({
            itemId: movement.itemId,
            targetSpaceId: movement.targetSpaceId,
          })),
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      showToast({
        type: "success",
        title: "Movimentações realizadas",
        message: `${data.updatedCount || movements.length} patrimônio(s) atualizado(s).`,
      });
      setMovements([]);
      setReason("");
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao movimentar",
        message:
          error.response?.data?.error ||
          "Não foi possível executar as movimentações.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-600">Carregando...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-sky-700">
                Movimentação planejada
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">
                Movimentar patrimônios
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {activeInventory?.name || "Inventário ativo"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge
                  label={`Inventário ${activeInventory?.statusOperacao || "ativo"}`}
                  className={
                    activeInventory?.statusOperacao === "PAUSADO"
                      ? "bg-orange-100 text-orange-800 ring-orange-200"
                      : activeInventory?.statusOperacao === "EM_AUDITORIA"
                        ? "bg-indigo-100 text-indigo-800 ring-indigo-200"
                        : "bg-emerald-100 text-emerald-800 ring-emerald-200"
                  }
                />
                <StatusBadge
                  label="Aceita salas lacradas"
                  className="bg-cyan-100 text-cyan-800 ring-cyan-200"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="self-start rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-800 shadow-sm hover:bg-sky-50"
            >
              Voltar ao dashboard
            </button>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="space-y-5">
            <div className="rounded-xl border border-sky-100 bg-white p-5 shadow-sm">
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Patrimônio
                  </label>
                  <input
                    type="search"
                    value={itemSearch}
                    onChange={(event) => {
                      setItemSearch(event.target.value);
                      setSelectedItem(null);
                    }}
                    placeholder="Número ou descrição"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                  <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60">
                    {itemSearching ? (
                      <div className="px-3 py-4 text-sm text-slate-500">
                        Buscando...
                      </div>
                    ) : itemResults.length > 0 ? (
                      itemResults.map((item) => {
                        const isSelected = selectedItem?.id === item.id;
                        const alreadyAdded = movements.some(
                          (movement) => movement.itemId === item.id,
                        );
                        const itemVisual = getItemStatusVisual(
                          item.statusEncontrado,
                        );
                        const originSpace =
                          spacesById.get(item.spaceId) || {
                            id: item.spaceId,
                            name: item.spaceName,
                            isFinalized: item.spaceIsFinalized,
                          };
                        const originVisual = getSpaceVisual(originSpace);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => setSelectedItem(item)}
                            className={`block w-full border-b px-3 py-3 text-left last:border-b-0 ${
                              isSelected
                                ? "border-sky-200 bg-sky-100/80"
                                : alreadyAdded
                                  ? "bg-slate-50 opacity-60"
                                  : itemVisual.row
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">
                                  #{item.patrimonio || "sem patrimônio"}
                                </div>
                                <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                                  {item.descricao}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <StatusBadge
                                    label={itemVisual.label}
                                    className={itemVisual.badge}
                                  />
                                  <StatusBadge
                                    label={`Origem ${originVisual.label}`}
                                    className={originVisual.badge}
                                  />
                                </div>
                                <p className="mt-2 text-xs font-medium text-slate-600">
                                  Origem: {item.spaceName}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                {item.isDuplicateSuspect ? (
                                  <StatusBadge
                                    label="Duplicata"
                                    className="bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200"
                                  />
                                ) : null}
                                {alreadyAdded ? (
                                  <StatusBadge
                                    label="Na lista"
                                    className="bg-slate-200 text-slate-700 ring-slate-300"
                                  />
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-4 text-sm text-slate-500">
                        Nenhum patrimônio selecionado.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Sala destino
                  </label>
                  <input
                    type="search"
                    value={spaceSearch}
                    onChange={(event) => {
                      setSpaceSearch(event.target.value);
                      setTargetSpaceId("");
                    }}
                    placeholder="Nome, setor ou responsável"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                  <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60">
                    {spacesLoading ? (
                      <div className="px-3 py-4 text-sm text-slate-500">
                        Carregando salas...
                      </div>
                    ) : filteredSpaces.length > 0 ? (
                      filteredSpaces.map((space) => {
                        const isSelected = targetSpaceId === space.id;
                        const spaceVisual = getSpaceVisual(space);
                        return (
                          <button
                            key={space.id}
                            type="button"
                            onClick={() => {
                              setTargetSpaceId(space.id);
                              setSpaceSearch(space.name);
                            }}
                            className={`block w-full border-b px-3 py-3 text-left last:border-b-0 ${
                              isSelected
                                ? "border-sky-200 bg-sky-100/80"
                                : spaceVisual.row
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 gap-3">
                                <span
                                  className={`mt-1 h-9 w-1.5 rounded-full ${spaceVisual.accent}`}
                                />
                                <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">
                                  {space.name}
                                </div>
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {space.responsibleDisplay ||
                                    space.responsible ||
                                    "Responsável não informado"}
                                </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <StatusBadge
                                      label={spaceVisual.label}
                                      className={spaceVisual.badge}
                                    />
                                    <StatusBadge
                                      label={`${space.itemCount || 0} itens`}
                                      className="bg-white text-slate-700 ring-slate-200"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-4 text-sm text-slate-500">
                        Nenhuma sala encontrada.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={addMovement}
                  disabled={!canAddMovement}
                  className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Incluir movimentação
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-sky-100 bg-white shadow-sm">
              <div className="border-b border-sky-100 bg-sky-50/70 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-950">
                  Lista de movimentações
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3">Patrimônio</th>
                      <th className="px-5 py-3">Origem</th>
                      <th className="px-5 py-3">Destino</th>
                      <th className="px-5 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {movements.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-5 py-8 text-center text-sm text-slate-500"
                        >
                          Nenhuma movimentação adicionada.
                        </td>
                      </tr>
                    ) : (
                      movements.map((movement) => {
                        const itemVisual = getItemStatusVisual(
                          movement.statusEncontrado,
                        );
                        const sourceVisual = getSpaceVisual(
                          movement.sourceSpace,
                        );
                        const targetVisual = getSpaceVisual(
                          movement.targetSpace,
                        );

                        return (
                        <tr
                          key={movement.itemId}
                          className="align-top hover:bg-sky-50/40"
                        >
                          <td className="px-5 py-4">
                            <div className="text-sm font-semibold text-slate-900">
                              #{movement.patrimonio || "sem patrimônio"}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs text-slate-500">
                              {movement.descricao}
                            </div>
                            <div className="mt-2">
                              <StatusBadge
                                label={itemVisual.label}
                                className={itemVisual.badge}
                              />
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">
                            <div className="font-medium text-slate-800">
                              {movement.sourceSpaceName}
                            </div>
                            <div className="mt-2">
                              <StatusBadge
                                label={sourceVisual.label}
                                className={sourceVisual.badge}
                              />
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">
                            <div className="font-medium text-slate-800">
                              {movement.targetSpaceName}
                            </div>
                            <div className="mt-2">
                              <StatusBadge
                                label={targetVisual.label}
                                className={targetVisual.badge}
                              />
                            </div>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => removeMovement(movement.itemId)}
                              className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-xl border border-sky-100 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                Resumo
              </h2>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
                  <dt className="text-xs font-medium text-sky-700">
                    Patrimônios
                  </dt>
                  <dd className="mt-1 text-2xl font-bold text-sky-950">
                    {movements.length}
                  </dd>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                  <dt className="text-xs font-medium text-emerald-700">
                    Salas lacradas
                  </dt>
                  <dd className="mt-1 text-2xl font-bold text-emerald-950">
                    {
                      new Set(
                        movements.flatMap((movement) => [
                          movement.sourceSpaceFinalized
                            ? movement.sourceSpaceId
                            : null,
                          movement.targetSpaceFinalized
                            ? movement.targetSpaceId
                            : null,
                        ]).filter(Boolean),
                      ).size
                    }
                  </dd>
                </div>
              </dl>

              <label className="mt-5 block text-sm font-semibold text-slate-800">
                Justificativa
              </label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={5}
                placeholder="Motivo administrativo"
                className="mt-2 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />

              {hasFinalizedSpace ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                  Esta operação envolve sala lacrada.
                </div>
              ) : null}

              <button
                type="button"
                onClick={executeMovements}
                disabled={
                  submitting ||
                  movements.length === 0 ||
                  (hasFinalizedSpace && !reason.trim())
                }
                className="mt-5 w-full rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {submitting ? "Realizando..." : "Realizar movimentações"}
              </button>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
