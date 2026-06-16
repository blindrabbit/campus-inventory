"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

const roleLabels = {
  ADMIN: "Administrador global",
  ADMIN_CICLO: "Administrador do inventário",
  REVISOR: "Revisor",
  CONFERENTE: "Conferente",
  VISUALIZADOR: "Visualizador",
};

const roleGuides = [
  {
    role: "Conferente",
    tone: "Operação de campo",
    color: "border-sky-200 bg-sky-50 text-sky-900",
    can: [
      "Acessar as salas liberadas para conferência.",
      "Marcar itens como encontrados e informar a condição observada.",
      "Usar o modo leitura para buscar patrimônio, código de barras ou RFID.",
      "Localizar itens fora da sala pela busca do inventário e solicitar a movimentação quando permitido.",
    ],
    watch: [
      "Se o item não for encontrado no modo leitura, confira o número lido e tente novamente.",
      "Quando houver dúvida sobre duplicidade, divergência física ou etiqueta ilegível, registre a ocorrência e acione o revisor.",
    ],
  },
  {
    role: "Revisor",
    tone: "Validação e fechamento",
    color: "border-violet-200 bg-violet-50 text-violet-900",
    can: [
      "Revisar salas conferidas e validar a consistência dos registros.",
      "Finalizar, lacrar ou confirmar salas conforme o fluxo operacional.",
      "Analisar itens não localizados, duplicidades e movimentações pontuais.",
      "Criar ou ajustar salas quando necessário para continuidade da operação.",
    ],
    watch: [
      "Uma sala lacrada preserva o histórico, mas movimentações planejadas administrativas ainda podem registrar entradas e saídas.",
      "Divergências recorrentes devem ser encaminhadas ao administrador do inventário com exemplos de patrimônio ou código de barras.",
    ],
  },
  {
    role: "Administrador do inventário",
    tone: "Gestão do ciclo",
    color: "border-emerald-200 bg-emerald-50 text-emerald-900",
    can: [
      "Gerenciar usuários, permissões, espaços, dados, backups e status do inventário.",
      "Executar movimentações planejadas entre salas, inclusive salas lacradas.",
      "Importar acervo bibliográfico por XLSX e acompanhar criados, mesclados, pulados e erros.",
      "Consultar auditoria, itens não localizados, duplicatas e painel de acompanhamento.",
    ],
    watch: [
      "Toda movimentação deve manter logs nas salas de origem e destino.",
      "Antes de importar planilhas grandes, confirme inventário ativo, sala de destino e se o arquivo possui cabeçalho correto.",
    ],
  },
  {
    role: "Administrador global",
    tone: "Governança e suporte",
    color: "border-slate-200 bg-slate-100 text-slate-900",
    can: [
      "Acessar recursos globais, relatório de eventos e funções administrativas avançadas.",
      "Apoiar diagnóstico de erros de autenticação, permissões, importações e eventos do sistema.",
      "Verificar impactos entre ciclos sem alterar registros operacionais sem solicitação formal.",
    ],
    watch: [
      "Alterações globais devem ser comunicadas ao responsável pelo ciclo do inventário.",
      "Eventos técnicos com falha repetida devem ser registrados com data, usuário, inventário e ação executada.",
    ],
  },
  {
    role: "Visualizador",
    tone: "Consulta",
    color: "border-amber-200 bg-amber-50 text-amber-900",
    can: [
      "Consultar salas, itens e situação geral conforme permissão recebida.",
      "Acompanhar informações sem alterar o estado do inventário.",
    ],
    watch: [
      "Se precisar corrigir, mover ou validar itens, solicite apoio a um conferente, revisor ou administrador do inventário.",
    ],
  },
];

const operations = [
  {
    title: "Entrar no sistema e selecionar inventário",
    steps: [
      "Acesse com usuário e senha cadastrados.",
      "Escolha o inventário ativo antes de iniciar qualquer operação.",
      "Se o inventário não aparecer, confirme com o administrador se seu usuário foi vinculado ao ciclo correto.",
    ],
    level0: "Tente sair e entrar novamente. Verifique se está usando o login correto.",
    level1: "Validar vínculo do usuário ao inventário e perfil de acesso.",
  },
  {
    title: "Conferir uma sala",
    steps: [
      "No dashboard, abra a sala desejada.",
      "Localize o item na lista ou use o modo leitura.",
      "Marque o item como encontrado e informe a condição física quando solicitado.",
      "Ao concluir, solicite revisão ou finalize conforme seu perfil permitir.",
    ],
    level0: "Confira se está na sala correta e se a busca não possui espaços ou dígitos faltando.",
    level1: "Verificar permissão do usuário, estado da sala e logs recentes do item.",
  },
  {
    title: "Usar modo leitura",
    steps: [
      "Abra uma sala e clique no modo leitura.",
      "Leia o patrimônio, código de barras ou RFID.",
      "Quando o sistema encontrar o item, confirme a ação exibida.",
      "Se não encontrar, o modal exibirá uma mensagem clara para tentar nova leitura ou digitar manualmente.",
    ],
    level0: "Limpe o campo, tente uma nova leitura e confira se o leitor enviou todos os números.",
    level1: "Testar busca manual por patrimônio, código de barras e RFID; se todos falharem, verificar cadastro/importação.",
  },
  {
    title: "Movimentar patrimônios",
    steps: [
      "Acesse Administração > Movimentações.",
      "Busque o item, escolha a sala destino e clique em incluir movimentação.",
      "Monte a lista completa antes de executar.",
      "Clique em realizar movimentações para gravar todas as alterações e logs.",
    ],
    level0: "Revise origem, destino e se o item já está na lista antes de executar.",
    level1: "Confirmar se o usuário é administrador do ciclo e se os logs foram criados nas salas envolvidas.",
  },
  {
    title: "Importar acervo bibliográfico",
    steps: [
      "Acesse Administração > Dados.",
      "Selecione a sala de destino para livros sem patrimônio.",
      "Envie o XLSX da biblioteca.",
      "Acompanhe o resumo de criados, mesclados, pulados e erros.",
    ],
    level0: "Confirme se o arquivo é .xlsx, se possui cabeçalho e se a sala de destino foi selecionada.",
    level1: "Verificar erros por linha, duplicidade de código de barras e regra de mesclagem por patrimônio.",
  },
  {
    title: "Auditar não localizados e duplicatas",
    steps: [
      "Use as abas Não Localizados e Duplicatas no dashboard ou Administração > Auditoria.",
      "Analise histórico, sala esperada, sala observada e ações já realizadas.",
      "Registre a correção ou encaminhe para revisão quando houver conflito físico.",
    ],
    level0: "Filtre pelo patrimônio ou descrição e confira se o item não foi movimentado recentemente.",
    level1: "Comparar histórico de sala, movimentações planejadas e eventos do item.",
  },
];

const states = [
  {
    name: "Sala não iniciada",
    className: "bg-rose-50 text-rose-800 ring-rose-200",
    meaning: "Ainda não começou a conferência.",
  },
  {
    name: "Sala iniciada",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    meaning: "Existe conferência em andamento.",
  },
  {
    name: "Sala lacrada",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    meaning: "A sala foi finalizada e preserva histórico de fechamento.",
  },
  {
    name: "Sala confirmada",
    className: "bg-violet-50 text-violet-800 ring-violet-200",
    meaning: "Revisão validada pelo responsável.",
  },
  {
    name: "Item encontrado",
    className: "bg-sky-50 text-sky-800 ring-sky-200",
    meaning: "Item conferido fisicamente.",
  },
  {
    name: "Item pendente",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    meaning: "Item ainda sem confirmação na sala.",
  },
  {
    name: "Item não localizado",
    className: "bg-rose-50 text-rose-800 ring-rose-200",
    meaning: "Item esperado não foi encontrado ou precisa de auditoria.",
  },
  {
    name: "Acervo",
    className: "bg-indigo-50 text-indigo-800 ring-indigo-200",
    meaning: "Livro importado, podendo ter código de barras mesmo sem patrimônio.",
  },
];

const escalation = [
  {
    case: "Nível 0",
    owner: "Usuário final ou apoio local",
    actions: [
      "Repetir leitura ou busca manual.",
      "Conferir inventário ativo e sala selecionada.",
      "Validar se o arquivo enviado é XLSX.",
      "Atualizar a página quando a sessão estiver antiga.",
    ],
  },
  {
    case: "Nível 1",
    owner: "Helpdesk ou administrador do inventário",
    actions: [
      "Verificar perfil de acesso e vínculo ao inventário.",
      "Consultar logs, eventos e histórico de movimentação.",
      "Reproduzir a falha com o mesmo patrimônio, código de barras ou usuário.",
      "Registrar chamado com evidência, horário, tela acessada e resultado esperado.",
    ],
  },
  {
    case: "Escalar para Nível 2",
    owner: "Equipe técnica",
    actions: [
      "Erro sistêmico repetido após validação de permissão e dados.",
      "Importação com falha técnica não explicada pelo resumo de erros.",
      "Inconsistência entre logs, sala atual e histórico do item.",
      "Indisponibilidade de API, banco de dados ou autenticação.",
    ],
  },
];

function getCurrentAccess() {
  if (typeof window === "undefined") return { user: null, inventory: null };

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const inventory = JSON.parse(localStorage.getItem("activeInventory") || "null");
  return { user, inventory };
}

function SectionTitle({ eyebrow, title, description }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-xl font-bold text-slate-950">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      ) : null}
    </div>
  );
}

function Pill({ children, className }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${className}`}>
      {children}
    </span>
  );
}

export default function HelpPage() {
  const router = useRouter();
  const { user, inventory } = useMemo(getCurrentAccess, []);
  const currentRole = inventory?.role || user?.inventoryRole || user?.role;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
              >
                ← Dashboard
              </button>
              <h1 className="mt-2 text-2xl font-bold text-slate-950">
                Ajuda operacional
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Guia de uso, comportamento do sistema e atendimento inicial para o inventário do campus.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-950">
                Perfil atual: {roleLabels[currentRole] || "Não identificado"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {inventory?.name || "Inventário ativo não carregado nesta tela"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-5 shadow-sm">
          <SectionTitle
            eyebrow="Primeiro atendimento"
            title="Como usar este guia"
            description="Comece pelo seu perfil de acesso, siga o fluxo da operação que está tentando executar e use as orientações de Nível 0 antes de acionar o suporte. Quando o problema envolver permissão, logs ou inconsistência de dados, registre as evidências para atendimento Nível 1."
          />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-white bg-white/80 p-4">
              <p className="text-sm font-semibold text-slate-950">1. Identifique o contexto</p>
              <p className="mt-1 text-sm text-slate-600">
                Usuário, inventário, sala, patrimônio ou código de barras.
              </p>
            </div>
            <div className="rounded-lg border border-white bg-white/80 p-4">
              <p className="text-sm font-semibold text-slate-950">2. Reproduza com calma</p>
              <p className="mt-1 text-sm text-slate-600">
                Repita a leitura, confirme a sala e tente busca manual.
              </p>
            </div>
            <div className="rounded-lg border border-white bg-white/80 p-4">
              <p className="text-sm font-semibold text-slate-950">3. Escale com evidência</p>
              <p className="mt-1 text-sm text-slate-600">
                Informe horário, tela, mensagem, item e ação esperada.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <SectionTitle
            eyebrow="Categorias de acesso"
            title="O que cada perfil pode fazer"
            description="As permissões são aplicadas por inventário. Um usuário pode ter acesso diferente em ciclos distintos."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {roleGuides.map((guide) => (
              <article key={guide.role} className={`rounded-xl border p-5 shadow-sm ${guide.color}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-bold">{guide.role}</h3>
                  <Pill className="bg-white/70 text-current ring-current/20">{guide.tone}</Pill>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-semibold">Pode realizar</p>
                    <ul className="mt-2 space-y-2 text-sm leading-5">
                      {guide.can.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Atenção operacional</p>
                    <ul className="mt-2 space-y-2 text-sm leading-5">
                      {guide.watch.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <SectionTitle
            eyebrow="Fluxos do sistema"
            title="Procedimentos mais usados"
            description="Use estes roteiros para orientar usuários em dúvidas recorrentes e padronizar o primeiro atendimento."
          />
          <div className="grid gap-4">
            {operations.map((operation) => (
              <article key={operation.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-bold text-slate-950">{operation.title}</h3>
                <ol className="mt-3 grid gap-2 text-sm leading-6 text-slate-700 md:grid-cols-2">
                  {operation.steps.map((step, index) => (
                    <li key={step} className="rounded-lg bg-slate-50 px-3 py-2">
                      <span className="mr-2 font-semibold text-sky-700">{index + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    <strong>Nível 0:</strong> {operation.level0}
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                    <strong>Nível 1:</strong> {operation.level1}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="space-y-4">
            <SectionTitle
              eyebrow="Comportamentos visuais"
              title="Cores e estados"
              description="As cores ajudam a identificar rapidamente o estágio da sala ou situação do item."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {states.map((state) => (
                <div key={state.name} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <Pill className={state.className}>{state.name}</Pill>
                  <p className="mt-3 text-sm text-slate-600">{state.meaning}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <SectionTitle
              eyebrow="Escalonamento"
              title="Quando acionar suporte"
              description="Use a menor escala possível para resolver rápido, mas registre evidências quando houver risco de dado incorreto."
            />
            {escalation.map((item) => (
              <div key={item.case} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-950">{item.case}</h3>
                  <Pill className="bg-slate-100 text-slate-700 ring-slate-200">{item.owner}</Pill>
                </div>
                <ul className="mt-3 space-y-2 text-sm leading-5 text-slate-600">
                  {item.actions.map((action) => (
                    <li key={action}>• {action}</li>
                  ))}
                </ul>
              </div>
            ))}
          </aside>
        </section>
      </main>
    </div>
  );
}
