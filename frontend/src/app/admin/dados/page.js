"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

// Mapeamento das colunas esperadas no XLSX da biblioteca
const COLUMN_GUIDE = [
  { col: "B",  field: "Código de barras",   note: "Identificador principal" },
  { col: "C",  field: "Código do exemplar", note: "" },
  { col: "P",  field: "Nº do exemplar",     note: "" },
  { col: "AF", field: "Nº do patrimônio",   note: "Opcional — mescla com item existente" },
  { col: "AH", field: "Título",             note: "Usado como descrição" },
  { col: "BA", field: "Autores",            note: "" },
  { col: "BG", field: "Ano de publicação",  note: "" },
  { col: "—",  field: "Código RFID",        note: "Última coluna (adicionada manualmente)" },
];

export default function AdminDadosPage() {
  const router = useRouter();

  const [spaces, setSpaces]         = useState([]);
  const [spaceId, setSpaceId]       = useState("");
  const [file, setFile]             = useState(null);
  const [importing, setImporting]   = useState(false);
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState(null);
  const fileInputRef                = useRef(null);

  useEffect(() => {
    const token       = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const user        = JSON.parse(localStorage.getItem("user") || "null");

    if (!token) { router.push("/login"); return; }
    if (!inventoryId) { router.push("/inventories"); return; }

    const isAdmin =
      user?.role === "ADMIN" ||
      user?.inventoryRole === "ADMIN_CICLO";

    if (!isAdmin) { router.push("/dashboard"); return; }

    axios
      .get(`${API}/spaces/admin/spaces`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(({ data }) => {
        setSpaces(data);
        if (data.length > 0) setSpaceId(data[0].id);
      })
      .catch(() => setError("Não foi possível carregar as salas."));
  }, [router]);

  async function handleImport() {
    if (!file || !spaceId) return;

    const token       = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const form        = new FormData();
    form.append("xlsxFile", file);
    form.append("spaceId", spaceId);
    form.append("inventoryId", inventoryId);

    setImporting(true);
    setResult(null);
    setError(null);

    try {
      // Não definir Content-Type manualmente: axios detecta FormData
      // e adiciona o boundary correto automaticamente.
      const { data } = await axios.post(`${API}/items/import-books`, form, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-inventory-id": inventoryId,
        },
      });
      setResult(data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err.response?.data?.error || "Erro ao importar arquivo.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-sm text-gray-500 hover:text-gray-800 transition"
          >
            ← Dashboard
          </button>
          <span className="text-gray-300">/</span>
          <h1 className="text-base font-semibold text-gray-800">
            Importação de Dados — Acervo Bibliográfico
          </h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Guia de colunas */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-1">
            Formato esperado do XLSX
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Use o arquivo exportado do sistema de biblioteca. A primeira linha deve ser o cabeçalho.
            O sistema lê as colunas abaixo por <strong>posição</strong> (não por nome).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left font-medium text-gray-500 border border-gray-200 w-12">Col.</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 border border-gray-200">Campo</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 border border-gray-200">Observação</th>
                </tr>
              </thead>
              <tbody>
                {COLUMN_GUIDE.map(({ col, field, note }) => (
                  <tr key={col} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 border border-gray-200 font-mono text-gray-700">{col}</td>
                    <td className="px-3 py-1.5 border border-gray-200 text-gray-800">{field}</td>
                    <td className="px-3 py-1.5 border border-gray-200 text-gray-400 text-xs">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <strong>Mesclagem automática:</strong> se a coluna AF (patrimônio) estiver preenchida e o item já existir no inventário,
            os campos de acervo (cód. barras, RFID, autores, ano) serão adicionados ao item existente sem apagar os dados patrimoniais.
            Itens sem patrimônio são criados como novos e marcados com a badge <strong>Acervo</strong>.
          </p>
        </section>

        {/* Formulário de upload */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Enviar arquivo</h2>

          {/* Seletor de sala */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sala de destino{" "}
              <span className="text-gray-400 font-normal text-xs">
                (para itens sem patrimônio que serão criados como novos)
              </span>
            </label>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {spaces.length === 0 && (
                <option value="">Carregando salas...</option>
              )}
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Seletor de arquivo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Arquivo XLSX
            </label>
            <div
              className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                file
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files[0];
                if (dropped?.name.endsWith(".xlsx")) setFile(dropped);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-800">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(0)} KB — clique para trocar
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400">
                  <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <p className="text-sm">
                    Arraste um arquivo <strong>.xlsx</strong> ou clique para selecionar
                  </p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {error}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={!file || !spaceId || importing}
            className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {importing ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Importando...
              </>
            ) : (
              "Importar livros"
            )}
          </button>
        </section>

        {/* Resultado da importação */}
        {result && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="font-semibold text-gray-800">
                Importação concluída — Sala: {result.spaceName}
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Criados" value={result.summary.created} color="green" icon="✨" />
              <StatCard label="Mesclados" value={result.summary.merged} color="blue" icon="🔗" />
              <StatCard label="Pulados" value={result.summary.skipped} color="gray" icon="⏭️" />
              <StatCard label="Erros" value={result.summary.errors} color={result.summary.errors > 0 ? "red" : "gray"} icon="❌" />
            </div>

            {result.errors?.length > 0 && (
              <div>
                <p className="text-sm font-medium text-red-700 mb-2">
                  Detalhes dos erros:
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs bg-red-50 border border-red-100 rounded px-3 py-1.5 text-red-700">
                      <span className="font-mono mr-2">Linha {e.row}</span>
                      {e.code && <span className="mr-2">({e.code})</span>}
                      {e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400">
              Itens criados sem número de patrimônio aparecem com a badge{" "}
              <span className="inline-flex items-center gap-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
                📚 Acervo
              </span>{" "}
              nas salas do inventário.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  const colors = {
    green: "border-green-200 bg-green-50 text-green-800",
    blue:  "border-blue-200 bg-blue-50 text-blue-800",
    gray:  "border-gray-200 bg-gray-50 text-gray-600",
    red:   "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color] || colors.gray}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5">{icon} {label}</p>
    </div>
  );
}
