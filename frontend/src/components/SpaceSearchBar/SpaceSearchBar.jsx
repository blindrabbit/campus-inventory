"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function SpaceSearchBar({
  className = "",
  placeholder = "Buscar espaços por nome...",
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const tokenRef = useRef(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    tokenRef.current = localStorage.getItem("token");
  }, []);

  useEffect(() => {
    const handleShortcut = (event) => {
      const isCommandK =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (!isCommandK) return;

      event.preventDefault();
      inputRef.current?.focus();
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const term = query.trim();

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (term.length < 2) {
      setResults([]);
      setIsOpen(false);
      setActiveIndex(-1);
      return undefined;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setIsLoading(true);
        const token = tokenRef.current || localStorage.getItem("token");
        const inventoryId = localStorage.getItem("activeInventoryId");
        const { data } = await axios.get(`${API}/spaces/active`, {
          params: { q: term, inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        });
        setResults(data.slice(0, 10));
        setIsOpen(true);
        setActiveIndex(data.length > 0 ? 0 : -1);
      } catch (error) {
        showToast({
          type: "error",
          title: "Falha na busca",
          message:
            error.response?.data?.error || "Não foi possível buscar espaços.",
        });
        setResults([]);
        setIsOpen(false);
        setActiveIndex(-1);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, showToast]);

  const selectedLabel = useMemo(() => {
    if (activeIndex < 0 || activeIndex >= results.length) return "";
    const selected = results[activeIndex];
    return `${selected.name} • ${selected.itemCount} itens`;
  }, [activeIndex, results]);

  const handleSelect = (space) => {
    setQuery(space.name);
    setIsOpen(false);
    setResults([]);
    setActiveIndex(-1);
    router.push(`/room/${space.id}`);
  };

  const handleKeyDown = (event) => {
    if (!isOpen || results.length === 0) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      handleSelect(results[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className={`relative w-full ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 pr-12 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-label="Buscar espaços"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
          {isLoading ? "..." : "🔍"}
        </span>
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="max-h-80 overflow-auto p-2">
            {results.map((space, index) => (
              <button
                key={space.id}
                type="button"
                onClick={() => handleSelect(space)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-start justify-between gap-4 rounded-xl px-4 py-3 text-left transition ${
                  index === activeIndex ? "bg-sky-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {space.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {space.responsible || "Não informado"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {space.itemCount} itens
                </span>
              </button>
            ))}
          </div>
          {selectedLabel ? (
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Selecionado: {selectedLabel}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
