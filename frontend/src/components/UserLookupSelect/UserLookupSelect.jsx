"use client";

import { useState } from "react";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function UserLookupSelect({
  label,
  placeholder,
  buttonText = "Buscar",
  onUserPicked,
  showToast,
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");

  const runSearch = async () => {
    const token = localStorage.getItem("token");
    const trimmed = query.trim();

    if (!trimmed || trimmed.length < 2) {
      showToast?.({
        type: "warning",
        title: "Busca curta",
        message: "Digite ao menos 2 caracteres para buscar servidor.",
      });
      return;
    }

    setSearching(true);
    try {
      const { data } = await axios.get(`${API}/inventories/users/search`, {
        params: { q: trimmed },
        headers: { Authorization: `Bearer ${token}` },
      });

      const users = (data?.users || []).slice(0, 5);
      setResults(users);
      setSelectedKey("");

      if (users.length === 0) {
        showToast?.({
          type: "info",
          title: "Sem resultados",
          message: "Nenhum servidor encontrado para o termo informado.",
        });
      }
    } catch (error) {
      showToast?.({
        type: "error",
        title: "Falha na busca",
        message:
          error.response?.data?.error ||
          "Não foi possível buscar os servidores.",
      });
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (value) => {
    setSelectedKey(value);
    const found = results.find(
      (user) => `${user.samAccountName}::${user.fullName}` === value,
    );

    if (!found) return;

    onUserPicked?.({
      userId: found.userId || null,
      samAccountName: found.samAccountName,
      fullName: found.fullName,
      existsLocally: Boolean(found.existsLocally),
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-800">{label}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={searching}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
        >
          {searching ? "Buscando..." : buttonText}
        </button>
      </div>

      {results.length > 0 ? (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Selecione um resultado (até 5)
          </label>
          <select
            value={selectedKey}
            onChange={(event) => handleSelect(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Selecione...</option>
            {results.map((user) => {
              const key = `${user.samAccountName}::${user.fullName}`;
              return (
                <option key={key} value={key}>
                  {user.samAccountName} - {user.fullName}
                </option>
              );
            })}
          </select>
        </div>
      ) : null}
    </div>
  );
}
