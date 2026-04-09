"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../../components/Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function AdminSpacesPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [spaces, setSpaces] = useState([]);
  const [newSpace, setNewSpace] = useState({
    name: "",
    responsible: "",
    sector: "",
    unit: "",
  });
  const [editValues, setEditValues] = useState({});

  const loadSpaces = async (token, inventoryId) => {
    try {
      const { data } = await axios.get(`${API}/spaces/admin/spaces`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });

      setSpaces(data);
      setEditValues(
        Object.fromEntries(data.map((space) => [space.id, space.name])),
      );
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar espaços",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os espaços.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const user = JSON.parse(localStorage.getItem("user") || "null");

    if (!token) {
      router.push("/login");
      return;
    }

    if (!inventoryId) {
      router.push("/inventories");
      return;
    }

    if (user?.role !== "ADMIN") {
      showToast({
        type: "error",
        title: "Acesso negado",
        message: "Somente administradores podem acessar os espaços.",
      });
      router.push("/dashboard");
      return;
    }

    loadSpaces(token, inventoryId);
  }, [router, showToast]);

  const handleCreate = async (event) => {
    event.preventDefault();
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");

    try {
      await axios.post(
        `${API}/spaces/admin/spaces`,
        { ...newSpace, inventoryId },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      showToast({
        type: "success",
        title: "Espaço criado",
        message: "O espaço foi adicionado com sucesso.",
      });

      setNewSpace({ name: "", responsible: "", sector: "", unit: "" });
      await loadSpaces(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao criar",
        message:
          error.response?.data?.error || "Não foi possível criar o espaço.",
      });
    }
  };

  const handleUpdate = async (spaceId) => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");

    try {
      await axios.put(
        `${API}/spaces/admin/spaces/${spaceId}`,
        { name: editValues[spaceId], inventoryId },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      showToast({
        type: "success",
        title: "Espaço atualizado",
        message: "O nome do espaço foi alterado.",
      });

      await loadSpaces(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao atualizar",
        message:
          error.response?.data?.error || "Não foi possível atualizar o espaço.",
      });
    }
  };

  const handleDelete = async (spaceId) => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");

    try {
      await axios.delete(`${API}/spaces/admin/spaces/${spaceId}`, {
        data: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });

      showToast({
        type: "success",
        title: "Espaço desativado",
        message: "O espaço foi desativado com sucesso.",
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

  if (loading) {
    return <div className="p-8 text-center text-slate-600">Carregando...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-600">
                Administração
              </p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">
                Gestão de espaços
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Crie, edite e desative espaços sem sair do fluxo administrativo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="self-start rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Voltar ao dashboard
            </button>
          </div>

          <form
            onSubmit={handleCreate}
            className="mt-6 grid gap-3 md:grid-cols-4"
          >
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Nome"
              value={newSpace.name}
              onChange={(event) =>
                setNewSpace((prev) => ({ ...prev, name: event.target.value }))
              }
              required
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Responsável"
              value={newSpace.responsible}
              onChange={(event) =>
                setNewSpace((prev) => ({
                  ...prev,
                  responsible: event.target.value,
                }))
              }
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Setor"
              value={newSpace.sector}
              onChange={(event) =>
                setNewSpace((prev) => ({ ...prev, sector: event.target.value }))
              }
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Unidade"
              value={newSpace.unit}
              onChange={(event) =>
                setNewSpace((prev) => ({ ...prev, unit: event.target.value }))
              }
            />
            <div className="md:col-span-4 flex justify-end">
              <button
                type="submit"
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
              >
                Criar espaço
              </button>
            </div>
          </form>
        </div>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-6 py-4">Nome</th>
                <th className="px-6 py-4">Responsável</th>
                <th className="px-6 py-4">Itens</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {spaces.map((space) => (
                <tr key={space.id} className="align-top">
                  <td className="px-6 py-4">
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      value={editValues[space.id] || ""}
                      onChange={(event) =>
                        setEditValues((prev) => ({
                          ...prev,
                          [space.id]: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    {space.responsible || "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    {space.itemCount}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${space.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                    >
                      {space.isActive
                        ? space.isFinalized
                          ? "Ativo / Finalizado"
                          : "Ativo"
                        : "Desativado"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdate(space.id)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(space.id)}
                        disabled={space.itemCount > 0}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Desativar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
