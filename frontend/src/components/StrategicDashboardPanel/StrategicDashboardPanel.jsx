"use client";

const numberFormatter = new Intl.NumberFormat("pt-BR");

const EVENT_LABELS = {
  item_checked: "Item conferido",
  item_unfound: "Item não localizado",
  item_unchecked: "Conferência desfeita",
  item_verified: "Item verificado",
  item_relocated: "Item realocado",
  group_relocated: "Grupo realocado",
  batch_checked: "Conferência em massa",
  batch_unfound: "Não localizados em massa",
  batch_relocated: "Movimentação em massa",
  space_auto_reverted: "Sala reaberta",
};

function formatPercent(value) {
  const percent = Number.isFinite(value) ? value * 100 : 0;
  return `${percent.toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return "Agora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Agora";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function MetricCard({ label, value, hint, tone = "slate", icon }) {
  const tones = {
    slate: "from-slate-50 to-white ring-slate-200 text-slate-900",
    blue: "from-sky-50 to-white ring-sky-200 text-sky-900",
    emerald: "from-emerald-50 to-white ring-emerald-200 text-emerald-900",
    amber: "from-amber-50 to-white ring-amber-200 text-amber-900",
    rose: "from-rose-50 to-white ring-rose-200 text-rose-900",
    purple: "from-purple-50 to-white ring-purple-200 text-purple-900",
    teal: "from-teal-50 to-white ring-teal-200 text-teal-900",
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 shadow-sm ring-1 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <span className="text-base opacity-60">{icon}</span>}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

function FunnelStage({ label, count, total, color, description }) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(0) : 0;
  const colors = {
    slate: { fill: "bg-slate-400", text: "text-slate-600" },
    blue: { fill: "bg-sky-500", text: "text-sky-700" },
    emerald: { fill: "bg-emerald-500", text: "text-emerald-700" },
    purple: { fill: "bg-purple-500", text: "text-purple-700" },
  };
  const c = colors[color] || colors.slate;

  return (
    <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-4">
      <p className={`text-xs font-semibold uppercase tracking-wide ${c.text}`}>{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{numberFormatter.format(count)}</p>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      <div className="mt-3 h-1.5 rounded-full bg-slate-100">
        <div
          className={`h-1.5 rounded-full transition-all ${c.fill}`}
          style={{ width: `${Math.max(count > 0 ? 4 : 0, Number(pct))}%` }}
        />
      </div>
      <p className={`mt-1.5 text-right text-xs font-semibold ${c.text}`}>{pct}% do total</p>
    </div>
  );
}

export default function StrategicDashboardPanel({
  summary,
  loading,
  error,
  recentEvents = [],
  visible = true,
}) {
  if (!visible) return null;

  if (loading && !summary) {
    return (
      <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-48 rounded bg-slate-200" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-100" />
            ))}
          </div>
          <div className="h-24 rounded-2xl bg-slate-100" />
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-56 rounded-2xl bg-slate-100" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error && !summary) {
    return (
      <section className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide">Painel estratégico</p>
        <p className="mt-2 text-sm">{error}</p>
      </section>
    );
  }

  if (!summary) return null;

  const totalItems = summary.totalItems || 0;
  const foundCount = summary.foundCount || 0;
  const unfoundCount = summary.unfoundCount || 0;
  const pendingCount = summary.pendingCount || 0;
  const relocatedPending = summary.relocatedPending || 0;
  const coveragePercent = summary.coveragePercent || 0;
  const lowCoverageSpaces = Array.isArray(summary.lowCoverageSpaces) ? summary.lowCoverageSpaces : [];

  const spacesCount = summary.spacesCount || 0;
  const spacesNotStarted = summary.spacesNotStarted ?? (spacesCount - (summary.spacesStarted || 0));
  const spacesInProgress = summary.spacesInProgress ?? 0;
  const spacesFinalizedOnly = summary.spacesFinalizedOnly ?? 0;
  const spacesVerifiedByRevisor = summary.spacesVerifiedByRevisor || 0;

  const itemsLast24h = summary.itemsLast24h || 0;
  const itemsLast7d = summary.itemsLast7d || 0;
  const verificationPending = summary.verificationPending || 0;
  const estimatedDays = summary.estimatedDays ?? null;
  const dailyPace = summary.dailyPace || 0;

  const dist = summary.coverageDistribution || { zero: 0, low: 0, medium: 0, complete: 0 };
  const distTotal = dist.zero + dist.low + dist.medium + dist.complete;

  let projectionValue, projectionHint, projectionTone;
  if (pendingCount === 0) {
    projectionValue = "Concluído";
    projectionHint = "Todos os itens foram conferidos";
    projectionTone = "emerald";
  } else if (estimatedDays === null || dailyPace === 0) {
    projectionValue = "—";
    projectionHint = "Sem atividade nos últimos 7 dias";
    projectionTone = "rose";
  } else if (estimatedDays === 0) {
    projectionValue = "< 1 dia";
    projectionHint = `Ritmo atual: ${dailyPace} itens/dia`;
    projectionTone = "emerald";
  } else {
    projectionValue = `~${numberFormatter.format(estimatedDays)} dias`;
    projectionHint = `Ritmo: ${dailyPace} itens/dia · ${numberFormatter.format(pendingCount)} restantes`;
    projectionTone = estimatedDays <= 7 ? "emerald" : estimatedDays <= 30 ? "amber" : "rose";
  }

  return (
    <section className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-sky-900 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">
              Acompanhamento em tempo real
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Painel estratégico do inventário
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Visão consolidada para acompanhar cobertura, ritmo de execução, divergências e pontos de risco enquanto as equipes atualizam o sistema.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-100 backdrop-blur">
            <p className="text-xs uppercase tracking-wide text-sky-200">Última atualização</p>
            <p className="mt-1 font-medium">{formatDateTime(summary.timestamp)}</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 px-5 py-5 sm:px-6">

        {/* KPI Row 1 — Itens */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Itens do inventário</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Cobertura geral"
              value={formatPercent(coveragePercent)}
              hint={`${numberFormatter.format(foundCount)} de ${numberFormatter.format(totalItems)} itens conferidos`}
              tone="blue"
              icon="📊"
            />
            <MetricCard
              label="Itens conferidos"
              value={numberFormatter.format(foundCount)}
              hint="Registrados como encontrados"
              tone="emerald"
              icon="✅"
            />
            <MetricCard
              label="Não localizados"
              value={numberFormatter.format(unfoundCount)}
              hint="Pendências que exigem tratamento"
              tone="rose"
              icon="⚠️"
            />
            <MetricCard
              label="Pendências em aberto"
              value={numberFormatter.format(pendingCount + relocatedPending)}
              hint={`${numberFormatter.format(pendingCount)} aguardando · ${numberFormatter.format(relocatedPending)} realocações`}
              tone="amber"
              icon="🕐"
            />
          </div>
        </div>

        {/* KPI Row 2 — Ritmo e risco */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Ritmo e pontos de atenção</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Atividade (24h)"
              value={numberFormatter.format(itemsLast24h)}
              hint={`${numberFormatter.format(itemsLast7d)} nos últimos 7 dias`}
              tone="teal"
              icon="⚡"
            />
            <MetricCard
              label="Salas revisadas"
              value={numberFormatter.format(spacesVerifiedByRevisor)}
              hint={`de ${numberFormatter.format(spacesCount)} salas no inventário`}
              tone="purple"
              icon="🔒"
            />
            <MetricCard
              label="Em reverificação"
              value={numberFormatter.format(verificationPending)}
              hint={verificationPending > 0 ? "Itens aguardando confirmação do revisor" : "Nenhum item em reverificação"}
              tone={verificationPending > 0 ? "amber" : "slate"}
              icon="🔍"
            />
            <MetricCard
              label="Projeção de conclusão"
              value={projectionValue}
              hint={projectionHint}
              tone={projectionTone}
              icon="🎯"
            />
          </div>
        </div>

        {/* Execution Funnel */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Funil de execução das salas</p>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {numberFormatter.format(spacesCount)} salas no total
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <FunnelStage
              label="Não iniciadas"
              count={spacesNotStarted}
              total={spacesCount}
              color="slate"
              description="Sem nenhuma conferência"
            />
            <div className="hidden items-center px-1 text-xl text-slate-300 sm:flex">›</div>
            <FunnelStage
              label="Em andamento"
              count={spacesInProgress}
              total={spacesCount}
              color="blue"
              description="Conferência iniciada"
            />
            <div className="hidden items-center px-1 text-xl text-slate-300 sm:flex">›</div>
            <FunnelStage
              label="Finalizada"
              count={spacesFinalizedOnly}
              total={spacesCount}
              color="emerald"
              description="Aguardando revisão"
            />
            <div className="hidden items-center px-1 text-xl text-slate-300 sm:flex">›</div>
            <FunnelStage
              label="Revisada e lacrada"
              count={spacesVerifiedByRevisor}
              total={spacesCount}
              color="purple"
              description="Confirmada pelo revisor"
            />
          </div>
        </div>

        {/* Bottom 3-column grid */}
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.9fr_0.9fr]">

          {/* Low coverage spaces */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cobertura por espaço</p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">Salas com maior risco</h3>
              </div>
              <div className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                Menor cobertura
              </div>
            </div>
            <div className="max-h-72 space-y-2 overflow-auto">
              {lowCoverageSpaces.length > 0 ? (
                lowCoverageSpaces.map((space) => {
                  const pct = space.coverage || 0;
                  const barColor =
                    pct === 0 ? "bg-rose-400" :
                    pct < 0.25 ? "bg-orange-400" :
                    pct < 0.5 ? "bg-amber-400" : "bg-sky-500";
                  const badgeColor =
                    pct === 0 ? "bg-rose-100 text-rose-700" :
                    pct < 0.25 ? "bg-orange-100 text-orange-700" :
                    pct < 0.5 ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700";
                  return (
                    <div key={space.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{space.name}</p>
                          <p className="text-xs text-slate-500">
                            {numberFormatter.format(space.checked || 0)} / {numberFormatter.format(space.total || 0)} itens
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeColor}`}>
                          {formatPercent(pct)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                        <div
                          className={`h-1.5 rounded-full ${barColor}`}
                          style={{ width: `${Math.max(pct > 0 ? 4 : 0, pct * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                  Nenhum espaço com baixa cobertura.
                </div>
              )}
            </div>
          </div>

          {/* Coverage distribution */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Distribuição de cobertura</p>
              <h3 className="mt-1 text-base font-semibold text-slate-900">Status das salas</h3>
            </div>
            <div className="space-y-4">
              {[
                { label: "Sem conferência (0%)", value: dist.zero, color: "bg-rose-400", textColor: "text-rose-600" },
                { label: "Baixa (1–49%)", value: dist.low, color: "bg-amber-400", textColor: "text-amber-600" },
                { label: "Média (50–99%)", value: dist.medium, color: "bg-sky-400", textColor: "text-sky-600" },
                { label: "Completa (100%)", value: dist.complete, color: "bg-emerald-500", textColor: "text-emerald-600" },
              ].map(({ label, value, color, textColor }) => (
                <div key={label}>
                  <div className="mb-1.5 flex justify-between">
                    <span className={`text-xs font-medium ${textColor}`}>{label}</span>
                    <span className="text-xs font-semibold text-slate-700">
                      {numberFormatter.format(value)} sala{value !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="h-4 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: `${distTotal > 0 ? Math.max(value > 0 ? 4 : 0, (value / distTotal) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {distTotal > 0 && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3">
                <p className="mb-2 text-center text-xs text-slate-500">
                  {distTotal} sala{distTotal !== 1 ? "s" : ""} com itens
                </p>
                <div className="flex h-3 overflow-hidden rounded-full gap-px">
                  {dist.zero > 0 && <div className="bg-rose-400" style={{ flex: dist.zero }} />}
                  {dist.low > 0 && <div className="bg-amber-400" style={{ flex: dist.low }} />}
                  {dist.medium > 0 && <div className="bg-sky-400" style={{ flex: dist.medium }} />}
                  {dist.complete > 0 && <div className="bg-emerald-500" style={{ flex: dist.complete }} />}
                </div>
              </div>
            )}
          </div>

          {/* Recent events */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Últimos eventos</p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">Atividade em tempo real</h3>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Live</span>
            </div>
            <div className="max-h-72 space-y-2 overflow-auto">
              {recentEvents.length > 0 ? (
                recentEvents.slice(0, 10).map((event, index) => {
                  const label = EVENT_LABELS[event.type] || event.type;
                  const user = event.data?.user || "Sistema";
                  const timestamp = event.data?.timestamp || event.receivedAt;
                  const count = event.data?.count;
                  const isRisk =
                    event.type === "space_auto_reverted" ||
                    event.type === "item_unfound" ||
                    event.type === "batch_unfound";

                  return (
                    <div
                      key={`${event.type}-${timestamp}-${index}`}
                      className={`rounded-xl border p-3 ${isRisk ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${isRisk ? "text-rose-800" : "text-slate-900"}`}>{label}</p>
                          <p className={`mt-0.5 truncate text-xs ${isRisk ? "text-rose-600" : "text-slate-500"}`}>
                            {user}{count != null ? ` · ${numberFormatter.format(count)} item(ns)` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                          {formatDateTime(timestamp)}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                  Nenhum evento recente registrado.
                </div>
              )}
            </div>
            {error && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
            )}
          </div>

        </div>
      </div>
    </section>
  );
}
