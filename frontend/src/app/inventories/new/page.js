"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../../components/Toast/toastContext";
import UserLookupSelect from "../../../components/UserLookupSelect/UserLookupSelect";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const INVENTORY_ROLES = [
  "ADMIN_CICLO",
  "CONFERENTE",
  "REVISOR",
  "VISUALIZADOR",
];

export default function NewInventoryPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);
  const [authorizedInventories, setAuthorizedInventories] = useState([]);
  const [memberInput, setMemberInput] = useState({
    role: "CONFERENTE",
  });
  const [ownerSelection, setOwnerSelection] = useState(null);
  const [pendingMember, setPendingMember] = useState(null);
  const [members, setMembers] = useState([]);
  const [xlsxFile, setXlsxFile] = useState(null);
  const [commissionPdfFile, setCommissionPdfFile] = useState(null);
  const [parsingCommissionPdf, setParsingCommissionPdf] = useState(false);
  const [commissionImportPreview, setCommissionImportPreview] = useState(null);
  const [form, setForm] = useState({
    name: "",
    campus: "Campus Aracruz",
    ownerSamAccountName: "",
    dataSource: "UPLOAD_XLSX",
    baseInventoryId: "",
    startDate: "",
    endDate: "",
  });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!token) {
      router.push("/login");
      return;
    }

    const parsedUser = userData ? JSON.parse(userData) : null;
    setUser(parsedUser);
    setOwnerSelection(
      parsedUser
        ? {
            userId: null,
            samAccountName: parsedUser.samAccountName,
            fullName: parsedUser.fullName,
            existsLocally: true,
          }
        : null,
    );
    setForm((prev) => ({
      ...prev,
      ownerSamAccountName: parsedUser?.samAccountName || "",
    }));

    loadInventoryOptions(token).finally(() => setLoading(false));
  }, [router]);

  const canCreate = useMemo(() => {
    if (user?.role === "ADMIN") return true;
    return authorizedInventories.some(
      (inventory) => inventory.role === "ADMIN_CICLO",
    );
  }, [user, authorizedInventories]);

  const reusableInventories = useMemo(
    () =>
      authorizedInventories.filter(
        (inventory) => inventory.statusOperacao === "FINALIZADO",
      ),
    [authorizedInventories],
  );

  const loadInventoryOptions = async (token) => {
    try {
      const { data } = await axios.get(`${API}/inventories/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setAuthorizedInventories(data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar opções",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os inventários disponíveis.",
      });
    }
  };

  const addMember = () => {
    if (!pendingMember?.samAccountName) {
      showToast({
        type: "warning",
        title: "Seleção obrigatória",
        message: "Busque e selecione um servidor antes de adicionar.",
      });
      return;
    }

    const sam = pendingMember.samAccountName.trim();

    if (
      members.some(
        (member) => member.samAccountName.toLowerCase() === sam.toLowerCase(),
      )
    ) {
      showToast({
        type: "warning",
        title: "Usuário duplicado",
        message: "Esse usuário já foi adicionado à lista inicial.",
      });
      return;
    }

    setMembers((prev) => [
      ...prev,
      {
        userId: pendingMember.userId || null,
        samAccountName: pendingMember.samAccountName,
        fullName: pendingMember.fullName,
        role: memberInput.role,
      },
    ]);
    setPendingMember(null);
    setMemberInput({ role: "CONFERENTE" });
  };

  const removeMember = (samAccountName) => {
    setMembers((prev) =>
      prev.filter((member) => member.samAccountName !== samAccountName),
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canCreate) {
      showToast({
        type: "error",
        title: "Sem permissão",
        message: "Seu perfil atual não permite criar inventários.",
      });
      return;
    }

    if (!form.name.trim()) {
      showToast({
        type: "warning",
        title: "Nome obrigatório",
        message: "Informe o nome do inventário.",
      });
      return;
    }

    if (!form.startDate) {
      showToast({
        type: "warning",
        title: "Data obrigatória",
        message: "Informe a data de início.",
      });
      return;
    }

    if (form.endDate && new Date(form.endDate) < new Date(form.startDate)) {
      showToast({
        type: "warning",
        title: "Datas inválidas",
        message: "A data de término não pode ser anterior ao início.",
      });
      return;
    }

    if (form.dataSource === "REUSE_BASE" && !form.baseInventoryId) {
      showToast({
        type: "warning",
        title: "Base obrigatória",
        message: "Selecione um inventário finalizado para reutilização.",
      });
      return;
    }

    if (form.dataSource === "UPLOAD_XLSX" && !xlsxFile) {
      showToast({
        type: "warning",
        title: "Arquivo obrigatório",
        message: "Selecione um arquivo XLSX ou PDF para criação por upload.",
      });
      return;
    }

    const token = localStorage.getItem("token");
    setSaving(true);

    try {
      const payload = new FormData();
      payload.append("name", form.name.trim());
      payload.append("campus", form.campus.trim() || "Campus Aracruz");
      payload.append(
        "ownerSamAccountName",
        ownerSelection?.samAccountName || form.ownerSamAccountName.trim(),
      );
      payload.append("dataSource", form.dataSource);
      if (form.dataSource === "REUSE_BASE") {
        payload.append("baseInventoryId", form.baseInventoryId);
      }
      payload.append("startDate", form.startDate);
      if (form.endDate) {
        payload.append("endDate", form.endDate);
      }
      payload.append("initialMembers", JSON.stringify(members));

      if (form.dataSource === "UPLOAD_XLSX" && xlsxFile) {
        payload.append("xlsxFile", xlsxFile);
      }

      const { data } = await axios.post(`${API}/inventories`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const importSummary = data?.importSummary;
      if (
        form.dataSource === "UPLOAD_XLSX" &&
        importSummary &&
        typeof importSummary.totalItemsRegistered === "number"
      ) {
        const knownLocationCount = Object.keys(
          importSummary.locationTotalsKnown || {},
        ).length;
        const failureCount = Array.isArray(importSummary.failures)
          ? importSummary.failures.length
          : 0;

        showToast({
          type: "info",
          title: "Resumo da leitura do arquivo",
          message: `Itens registrados: ${importSummary.totalItemsRegistered}. Localizações conhecidas: ${knownLocationCount}. Itens sem localização conhecida: ${importSummary.unknownLocationCount || 0}. Falhas reportadas: ${failureCount}.`,
        });

        const topLocations = Object.entries(
          importSummary.locationTotalsKnown || {},
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([location, count]) => `${location}: ${count}`)
          .join(" | ");

        if (topLocations) {
          showToast({
            type: "info",
            title: "Totais por localização",
            message: topLocations,
          });
        }

        const parseWarningFailure = Array.isArray(importSummary.failures)
          ? importSummary.failures.find(
              (failure) =>
                failure?.type === "PDF_PARSE_WARNING" ||
                failure?.type === "PDF_HEADER_NOT_DETECTED",
            )
          : null;

        if (parseWarningFailure) {
          showToast({
            type: "warning",
            title: "Atenção na leitura do PDF",
            message:
              parseWarningFailure.message ||
              "Houve linhas ignoradas durante a leitura do PDF.",
          });
        }
      }

      showToast({
        type: "success",
        title: "Inventário criado",
        message: "Novo ciclo criado com sucesso.",
      });

      if (data?.inventory?.id) {
        localStorage.setItem("activeInventoryId", data.inventory.id);
        localStorage.setItem(
          "activeInventory",
          JSON.stringify({
            id: data.inventory.id,
            name: data.inventory.name,
            role: "ADMIN_CICLO",
            statusOperacao: data.inventory.statusOperacao,
          }),
        );

        router.push("/dashboard");
        return;
      }

      router.push("/inventories");
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao criar inventário",
        message:
          error.response?.data?.error ||
          "Não foi possível criar o inventário com os dados informados.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleParseCommissionPdf = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }

    if (!commissionPdfFile) {
      showToast({
        type: "warning",
        title: "Arquivo obrigatório",
        message: "Selecione o PDF da portaria da comissão para importar.",
      });
      return;
    }

    setParsingCommissionPdf(true);
    try {
      const payload = new FormData();
      payload.append("commissionPdf", commissionPdfFile);

      const { data } = await axios.post(
        `${API}/inventories/commission/parse`,
        payload,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (data?.owner?.samAccountName) {
        setOwnerSelection({
          userId: data.owner.userId || null,
          samAccountName: data.owner.samAccountName,
          fullName: data.owner.fullName,
          existsLocally: Boolean(data.owner.existsLocally),
        });
        setForm((prev) => ({
          ...prev,
          ownerSamAccountName: data.owner.samAccountName,
        }));
      }

      setCommissionImportPreview({
        fileName: commissionPdfFile.name,
        parsedAt: new Date().toISOString(),
        owner: data?.owner || null,
        importedMembers: Array.isArray(data?.members) ? data.members : [],
        unresolvedNames: Array.isArray(data?.unresolvedNames)
          ? data.unresolvedNames
          : [],
        extractedMembers: Array.isArray(data?.extractedMembers)
          ? data.extractedMembers
          : [],
      });

      showToast({
        type: "success",
        title: "Portaria processada",
        message: `Prévia gerada. Não resolvidos: ${
          data?.unresolvedNames?.length || 0
        }.`,
      });

      if (Array.isArray(data?.unresolvedNames) && data.unresolvedNames.length) {
        showToast({
          type: "warning",
          title: "Nomes não identificados",
          message: data.unresolvedNames.join(", "),
        });
      }
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao processar portaria",
        message:
          error.response?.data?.error ||
          "Não foi possível extrair os dados da portaria.",
      });
    } finally {
      setParsingCommissionPdf(false);
    }
  };

  const handleConfirmCommissionImport = () => {
    if (!commissionImportPreview) return;

    let importedMembers = commissionImportPreview.importedMembers.map(
      (member) => ({
        userId: member.userId || null,
        samAccountName: member.samAccountName,
        fullName: member.fullName,
        role: member.role || "CONFERENTE",
      }),
    );

    let ownerFromPreview = commissionImportPreview.owner || null;
    if (!ownerFromPreview && importedMembers.length > 0) {
      const [fallbackOwner, ...remainingMembers] = importedMembers;
      ownerFromPreview = {
        userId: fallbackOwner.userId || null,
        samAccountName: fallbackOwner.samAccountName,
        fullName: fallbackOwner.fullName,
        existsLocally: true,
      };
      importedMembers = remainingMembers;
    }

    if (ownerFromPreview?.samAccountName) {
      setOwnerSelection({
        userId: ownerFromPreview.userId || null,
        samAccountName: ownerFromPreview.samAccountName,
        fullName: ownerFromPreview.fullName,
        existsLocally: Boolean(ownerFromPreview.existsLocally),
      });
      setForm((prev) => ({
        ...prev,
        ownerSamAccountName: ownerFromPreview.samAccountName,
      }));
    }

    setMembers(importedMembers);

    const appliedOwner = Boolean(ownerFromPreview?.samAccountName);
    const appliedMembers = importedMembers.length;

    if (!appliedOwner && appliedMembers === 0) {
      showToast({
        type: "warning",
        title: "Nenhum dado aplicado",
        message:
          "A prévia não trouxe responsável nem membros válidos para preencher o formulário.",
      });
      setCommissionImportPreview(null);
      return;
    }

    showToast({
      type: "success",
      title: "Importação confirmada",
      message: `Formulário atualizado: responsável ${
        appliedOwner ? "aplicado" : "não aplicado"
      }, membros aplicados: ${appliedMembers}.`,
    });

    setCommissionImportPreview(null);
  };

  const handleClearCommissionImport = () => {
    setCommissionPdfFile(null);
    setCommissionImportPreview(null);
    setOwnerSelection(
      user
        ? {
            userId: null,
            samAccountName: user.samAccountName,
            fullName: user.fullName,
            existsLocally: true,
          }
        : null,
    );
    setForm((prev) => ({
      ...prev,
      ownerSamAccountName: user?.samAccountName || "",
    }));
    setMembers([]);
    setPendingMember(null);
    setMemberInput({ role: "CONFERENTE" });
    showToast({
      type: "info",
      title: "Importação limpa",
      message: "Os dados da portaria foram removidos da tela.",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Carregando formulário...</p>
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-sky-100 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-2xl font-bold text-slate-900">
            Criar novo inventário
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Seu perfil atual não possui permissão para criar novos inventários.
          </p>
          <button
            type="button"
            onClick={() => router.push("/inventories")}
            className="mt-6 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Voltar para Meus Inventários
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-sky-100 px-4 py-8">
      <div className="mx-auto max-w-4xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Criar novo inventário
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Defina responsável, fonte de dados, período e usuários iniciais.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/inventories")}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Portaria da comissão de inventário
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Faça upload do PDF da portaria para preencher automaticamente o
              responsável pelo inventário e os usuários da comissão.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) =>
                  setCommissionPdfFile(event.target.files?.[0] || null)
                }
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleParseCommissionPdf}
                disabled={parsingCommissionPdf}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
              >
                {parsingCommissionPdf ? "Processando..." : "Importar portaria"}
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleClearCommissionImport}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Limpar importação
              </button>
            </div>

            {commissionImportPreview ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Prévia importada da portaria
                    </p>
                    <p className="text-xs text-slate-500">
                      {commissionImportPreview.fileName}
                    </p>
                  </div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    Processada em{" "}
                    {new Date(commissionImportPreview.parsedAt).toLocaleString(
                      "pt-BR",
                    )}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmCommissionImport}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    Confirmar importação da portaria
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Responsável pelo inventário
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {ownerSelection?.fullName ||
                        commissionImportPreview.owner?.fullName ||
                        "Não identificado"}
                    </p>
                    <p className="text-xs text-slate-600">
                      {ownerSelection?.samAccountName ||
                        commissionImportPreview.owner?.samAccountName ||
                        "Sem siape"}
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Servidores importados
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {commissionImportPreview.importedMembers.length} servidor
                      {commissionImportPreview.importedMembers.length === 1
                        ? ""
                        : "es"}
                    </p>
                    <p className="text-xs text-slate-600">
                      Serão adicionados como usuários normais
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Membros identificados
                    </p>
                    {commissionImportPreview.importedMembers.length > 0 ? (
                      <ul className="space-y-2">
                        {commissionImportPreview.importedMembers.map(
                          (member) => (
                            <li
                              key={member.samAccountName}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                            >
                              <span className="font-medium text-slate-900">
                                {member.fullName}
                              </span>
                              <span className="ml-2 text-xs text-slate-500">
                                {member.samAccountName}
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">
                        Nenhum servidor identificado.
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Nomes não resolvidos
                    </p>
                    {commissionImportPreview.unresolvedNames.length > 0 ? (
                      <ul className="space-y-2">
                        {commissionImportPreview.unresolvedNames.map((name) => (
                          <li
                            key={name}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                          >
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-emerald-700">
                        Todos os nomes foram resolvidos.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Nome do inventário *
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="text-sm text-slate-700">
              Campus
              <input
                value={form.campus}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, campus: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-sm text-slate-700">
              Fonte da carga inicial *
              <select
                value={form.dataSource}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    dataSource: event.target.value,
                    baseInventoryId: "",
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="UPLOAD_XLSX">Upload XLSX</option>
                <option value="REUSE_BASE">
                  Reutilizar inventário finalizado
                </option>
              </select>
            </label>

            <label className="text-sm text-slate-700">
              Data de início *
              <input
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    startDate: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="text-sm text-slate-700">
              Data de término
              <input
                type="date"
                value={form.endDate}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, endDate: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          {form.dataSource === "REUSE_BASE" ? (
            <label className="block text-sm text-slate-700">
              Inventário base finalizado *
              <select
                value={form.baseInventoryId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    baseInventoryId: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">Selecione...</option>
                {reusableInventories.map((inventory) => (
                  <option key={inventory.id} value={inventory.id}>
                    {inventory.name} ({inventory.campus || "Sem campus"})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-xl border border-slate-200 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Arquivo do inventário (XLSX ou PDF) *
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,application/pdf,.pdf"
                onChange={(event) =>
                  setXlsxFile(event.target.files?.[0] || null)
                }
                className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <p className="mt-2 text-xs text-slate-600">
                O arquivo (XLSX/PDF) será validado no backend antes da criação
                do inventário.
              </p>
            </div>
          )}

          <UserLookupSelect
            label="Buscar responsável pelo inventário (Siape ou Nome)"
            placeholder="Digite Siape ou Nome"
            onUserPicked={(picked) => {
              setOwnerSelection(picked);
              setForm((prev) => ({
                ...prev,
                ownerSamAccountName: picked.samAccountName,
              }));
            }}
            showToast={showToast}
          />

          {ownerSelection ? (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-200">
              Responsável selecionado: {ownerSelection.samAccountName} -{" "}
              {ownerSelection.fullName}
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Usuários adicionais com acesso
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <select
                value={memberInput.role}
                onChange={(event) =>
                  setMemberInput((prev) => ({
                    ...prev,
                    role: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {INVENTORY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <UserLookupSelect
                label="Buscar servidor com permissão (Siape ou Nome)"
                placeholder="Digite Siape ou Nome"
                buttonText="Buscar servidor"
                onUserPicked={(picked) => setPendingMember(picked)}
                showToast={showToast}
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={addMember}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
              >
                Adicionar servidor selecionado
              </button>
              {pendingMember ? (
                <p className="text-xs text-slate-600">
                  Selecionado: {pendingMember.samAccountName} -{" "}
                  {pendingMember.fullName}
                </p>
              ) : null}
            </div>

            {members.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {members.map((member) => (
                  <div
                    key={member.samAccountName}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
                  >
                    <span>
                      {member.samAccountName} ({member.fullName}) -{" "}
                      {member.role}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMember(member.samAccountName)}
                      className="font-semibold text-rose-700 hover:text-rose-800"
                    >
                      remover
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Nenhum usuário adicional informado.
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {saving ? "Criando..." : "Criar inventário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
