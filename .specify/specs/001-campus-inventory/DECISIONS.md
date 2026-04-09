# Decision Records (ADRs)

## ADR-001: Substituir Alerts Nativos por Modais Customizados

**Data**: 2026-01-20  
**Status**: APROVADO  
**Impacto**: UX, Acessibilidade, Código

### Contexto

O sistema atualmente usa `window.alert()` e `window.confirm()` para:

- Confirmar remoção de itens
- Confirmar finalização de salas
- Mostrar mensagens de erro/sucesso

### Problema

- Alerts nativos bloqueiam a thread principal
- Não são customizáveis visualmente
- Experiência ruim em mobile
- Não seguem guidelines de acessibilidade WCAG
- Quebram o fluxo de usuário

### Decisão

Implementar sistema de modais customizados com:

- Componente `Modal` genérico
- Componente `ConfirmModal` especializado
- Sistema de Toast para notificações
- Animações suaves (fade-in/out)
- Suporte a teclado (ESC para fechar)
- Focus trap para acessibilidade

### Consequências

✅ **Positivas:**

- Melhor UX/UI
- Acessibilidade WCAG AA
- Customização total
- Não bloqueia thread

⚠️ **Negativas:**

- Mais código para manter
- Necessidade de testes adicionais
- Curva de aprendizado para novos devs

### Alternativas Consideradas

1. Biblioteca pronta (React Modal, Radix UI) → Rejeitada: queremos controle total
2. Manter alerts nativos → Rejeitada: UX inaceitável

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#padrões-de-uiux`
- Plan: `.specify/specs/001-campus-inventory/plan.md#7-componentes-de-ui---modal-system`

## ADR-002: Busca de Espaços com Dropdown Reutilizável e Auditoria Baseada em Histórico

**Data**: 2026-04-08  
**Status**: APROVADO  
**Impacto**: UX, API, Auditoria, Manutenibilidade

### Contexto

O fluxo do sistema passou a exigir busca rápida de espaços no dashboard e na sala, além de rastreabilidade completa para remoções, realocações e itens não localizados.

### Problema

- A navegação por espaços precisava funcionar com debounce, atalhos de teclado e feedback visual consistente.
- O painel de auditoria precisava consultar histórico detalhado sem depender apenas do estado atual do item.
- Implementações separadas para dashboard e sala aumentariam duplicação e risco de divergência.

### Decisão

Implementar um componente reutilizável `SpaceSearchBar` e uma API de auditoria baseada em `ItemHistorico`, com:

- Busca remota em `/api/spaces/active?q=...`
- Dropdown com no máximo 10 resultados
- Atalho `Ctrl+K` / `Cmd+K`
- Navegação por setas e `Enter`
- Tela administrativa `/admin/unfound-items` para itens não localizados
- Histórico detalhado acessível em modal

### Consequências

✅ **Positivas:**

- Menor duplicação de código
- Busca consistente em todo o app
- Auditoria rastreável e extensível
- Melhor experiência para usuários administrativos

⚠️ **Negativas:**

- Mais endpoints e estados de UI para manter
- Requer disciplina para manter o histórico sincronizado com as ações de item
- A auditoria passa a depender da integridade dos registros históricos

### Alternativas Consideradas

1. Busca local apenas no frontend → Rejeitada: pior escalabilidade e menos fidelidade aos filtros de domínio.
2. Tela de auditoria sem histórico persistido → Rejeitada: não atende rastreabilidade exigida.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#funcionalidades-de-busca-e-navegação`

## ADR-005: Ações de Administração no Card de Espaços

**Data**: 2026-04-08  
**Status**: APROVADO  
**Impacto**: UX, Permissões, Operação

### Contexto

O dashboard já lista espaços para conferência, mas o fluxo administrativo exige ajustes rápidos de cadastro sem navegação extra.

### Problema

- Administração de espaços dependia de fluxo separado, aumentando cliques e tempo de operação.
- Faltava explicitação no spec de que o card de espaços pode conter ações administrativas.

### Decisão

Quando o usuário autenticado tiver role `ADMIN`, o card de espaços deve permitir:

- Criar novo espaço diretamente na tela de listagem
- Editar o nome de espaço existente no próprio card

### Consequências

✅ **Positivas:**

- Menos fricção para operações de cadastro
- Fluxo administrativo mais rápido
- Especificação mais clara para implementação frontend/backend

⚠️ **Negativas:**

- Requer controle estrito por role no frontend e backend
- Exige cuidado para não poluir o card para perfis não administrativos

### Alternativas Consideradas

1. Manter ações administrativas só em rota separada → Rejeitada: menor produtividade operacional.
2. Expor ações para todos os perfis → Rejeitada: viola modelo de permissão.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#seleção-de-espaço`
- Spec: `.specify/specs/001-campus-inventory/spec.md#crud-de-espaços-admin-apenas`

## ADR-004: Busca de Espaços Restrita ao Nome do Local

**Data**: 2026-04-08  
**Status**: APROVADO  
**Impacto**: UX, API, Consistência de Resultados

### Contexto

A busca de espaços estava consultando múltiplos campos e isso podia gerar resultados repetidos ou pouco previsíveis para o usuário.

### Problema

- Buscar por responsável ou setor aumenta a chance de exibir mais de um resultado para o mesmo contexto.
- A navegação precisa ser objetiva e consistente, especialmente no autocomplete do dashboard e da sala.
- O comportamento esperado é localizar o local pelo nome do local.

### Decisão

Restringir a busca de espaços ao campo `name` בלבד, mantendo os demais campos apenas para exibição.

### Consequências

✅ **Positivas:**

- Reduz duplicidade e ruído nos resultados.
- Deixa a busca mais previsível para o usuário.
- Mantém o autocomplete focado no nome do local.

⚠️ **Negativas:**

- Usuários não conseguem mais localizar espaços pelo responsável ou setor nesse atalho.
- Pode exigir padronização melhor dos nomes dos locais.

### Alternativas Consideradas

1. Buscar também por responsável e setor → Rejeitada: aumenta duplicidade.
2. Criar filtros separados por campo → Rejeitada: complexidade desnecessária para o fluxo atual.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#funcionalidades-de-busca-e-navegação`
- Spec: `.specify/specs/001-campus-inventory/spec.md#painel-de-auditoria-adminrevisor`
- Spec: `.specify/specs/001-campus-inventory/spec.md#fluxo-de-remoção-e-realocação-sem-aprovação`

## ADR-003: Busca de Espaços Resiliente a Bancos Legados

**Data**: 2026-04-08  
**Status**: APROVADO  
**Impacto**: API, Operação, Compatibilidade

### Contexto

A busca de espaços passou a depender de campos adicionais como `sector`, mas há ambientes em que o banco local pode estar defasado em relação ao schema mais novo.

### Problema

- Uma query que referencia uma coluna ausente falha com 500.
- Isso interrompe a navegação por espaços no dashboard e na sala.
- O mesmo código precisa funcionar tanto com bancos migrados quanto com ambientes ainda em transição.

### Decisão

Antes de montar o filtro de busca, consultar o schema SQLite e incluir apenas colunas existentes na cláusula `OR`.

### Consequências

✅ **Positivas:**

- Evita 500 em bancos defasados.
- Mantém a busca operacional durante rollout de migrações.
- Preserva a busca por `sector` quando a coluna existir.

⚠️ **Negativas:**

- Adiciona uma leitura extra de schema quando há termo de busca.
- Introduz uma pequena complexidade operacional na rota.

### Alternativas Consideradas

1. Remover `sector` da busca definitivamente → Rejeitada: perde requisito de negócio.
2. Exigir migração perfeita em todos os ambientes → Rejeitada: frágil durante desenvolvimento e deploy incremental.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#funcionalidades-de-busca-e-navegação`

## ADR-006: Reutilizar a Rota de Espaços com `includeFinalized=true` na Realocação

**Data**: 2026-04-08  
**Status**: APROVADO  
**Impacto**: API, UX, Reuso

### Contexto

O modal de realocação precisa listar espaços ativos e também espaços finalizados para permitir o retorno de itens, sem criar uma segunda API paralela para a mesma entidade.

### Problema

- A sala precisava enxergar opções de destino com regras diferentes das usadas no dashboard.
- Criar uma nova rota apenas para realocação aumentaria duplicação e risco de divergência.
- O dashboard continua precisando da lista estrita de espaços ativos e não finalizados.

### Decisão

Reutilizar a rota `/api/spaces/active` com o parâmetro `includeFinalized=true` quando o consumidor precisar listar destinos de realocação.

### Consequências

✅ **Positivas:**

- Mantém uma única fonte de verdade para listagem de espaços
- Evita duplicar lógica de consulta e ordenação
- Preserva o comportamento estrito do dashboard por padrão

⚠️ **Negativas:**

- A semântica da rota fica dependente de um parâmetro adicional
- Requer atenção do frontend para não enviar `includeFinalized=true` fora do fluxo de realocação

### Alternativas Consideradas

1. Criar uma rota separada para destino de realocação → Rejeitada: duplicação de código e regras.
2. Sempre listar finalizados em todas as telas → Rejeitada: polui o dashboard e viola o fluxo principal.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#fluxo-de-conferência`
- Spec: `.specify/specs/001-campus-inventory/spec.md#fluxo-de-remoção-e-realocação-sem-aprovação`

## ADR-007: UX de Administração no Dashboard e Contagem Espelhada da Sala

**Data**: 2026-04-08  
**Status**: APROVADO  
**Impacto**: UX, Consistência, Operação

### Contexto

O dashboard precisava de uma ação administrativa menos poluída visualmente, e a contagem dos cards passou a divergir do número de itens mostrados dentro da sala.

### Problema

- Botões administrativos dentro do card competiam com a navegação principal.
- O botão de novo espaço precisava ficar fora do card para não confundir a ação de conferência com a ação administrativa.
- A contagem do dashboard mostrava um total diferente do que o usuário via ao entrar na sala.

### Decisão

- Manter apenas um botão flutuante `✏️` no canto superior direito do card, visível no hover, para edição de nome.
- Exibir `📝 Novo espaço` fora do card, logo após a busca no header.
- Calcular a contagem do dashboard com a mesma regra de visibilidade aplicada na listagem da sala.

### Consequências

✅ **Positivas:**

- Menos ruído visual no card
- Fluxo administrativo mais claro
- Contagem consistente entre dashboard e sala

⚠️ **Negativas:**

- Requer cuidado para manter a regra de visibilidade sincronizada entre backend e frontend
- A edição de espaço fica menos explícita para quem não passa o mouse no card

## ADR-008: Importação de Portaria com Resolução Estrita por SIAPE

**Data**: 2026-04-09  
**Status**: APROVADO  
**Impacto**: Segurança de dados, Confiabilidade, Integração AD

### Contexto

O fluxo de importação da comissão por PDF gerava inconsistências ao tentar resolver nomes diretamente no AD, podendo sugerir pessoas não presentes no documento.

### Problema

- Busca por nome no AD pode retornar candidatos ambíguos.
- O documento oficial da comissão já contém SIAPE, que é identificador mais determinístico.
- O sistema precisava evitar preenchimento automático com falso positivo.

### Decisão

Resolver membros da portaria apenas por SIAPE com correspondência única no AD, com as seguintes regras:

- Extrair `nome + matrícula SIAPE` da portaria.
- Consultar SIAPE com match exato considerando `employeeID`, `sAMAccountName` e `uid`.
- Aceitar apenas resultado único.
- Se o resultado exato vier sem nome completo, enriquecer por busca adicional via `sAMAccountName`.
- Se não houver unicidade, manter em `unresolvedNames`.

### Consequências

✅ **Positivas:**

- Reduz falsos positivos de identidade.
- Aumenta rastreabilidade e previsibilidade da importação.
- Mantém o SIAPE como base objetiva de resolução.

⚠️ **Negativas:**

- Portarias com SIAPE inválido/incompleto passam a exigir correção manual.
- Dependência maior de consistência cadastral no AD.

### Alternativas Consideradas

1. Resolver por nome com ranking de similaridade → Rejeitada: risco de match incorreto.
2. Resolver apenas por `employeeID` → Rejeitada: há ambientes onde o SIAPE aparece em `sAMAccountName`/`uid`.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#importação-de-portaria-da-comissão-pdf`
- Plan: `.specify/specs/001-campus-inventory/plan.md#49-contratos-da-importação-de-portaria-da-comissão`

## ADR-009: Responsável da Comissão com Prioridade Explícita e Fallback Determinístico

**Data**: 2026-04-09  
**Status**: APROVADO  
**Impacto**: Regra de negócio, UX de criação de inventário

### Contexto

Nem toda portaria declara explicitamente quem é o responsável/presidente da comissão.

### Problema

- Em ausência de marcador explícito, o formulário ficava sem responsável.
- O usuário precisava de regra previsível para evitar bloqueio da criação do inventário.

### Decisão

Definir o responsável da importação com prioridade:

- primeiro membro explicitamente marcado como presidente/responsável/coordenador na portaria
- fallback para o primeiro nome válido extraído do documento

### Consequências

✅ **Positivas:**

- Mantém preenchimento funcional mesmo com documentos heterogêneos.
- Regra simples e auditável.

⚠️ **Negativas:**

- Em portarias sem marcação explícita, o primeiro nome pode não representar o presidente real.

### Alternativas Consideradas

1. Exigir marcação explícita obrigatória no PDF → Rejeitada: bloquearia documentos válidos na prática.
2. Não preencher responsável automaticamente → Rejeitada: piora experiência e aumenta erro manual.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#importação-de-portaria-da-comissão-pdf`

## ADR-010: Prévia Obrigatória com Confirmação Explícita na Importação de Portaria

**Data**: 2026-04-09  
**Status**: APROVADO  
**Impacto**: UX, Segurança operacional

### Contexto

A importação automática imediata após parse dificultava validação humana dos dados antes de gravar no formulário.

### Problema

- Usuário não conseguia revisar claramente o que seria aplicado.
- Toast de sucesso poderia sugerir aplicação mesmo sem dados válidos.

### Decisão

Adotar fluxo em duas etapas:

- etapa 1: gerar prévia (`owner`, `members`, `unresolvedNames`)
- etapa 2: aplicar no formulário somente após clique em "Confirmar importação da portaria"

Ao confirmar:

- aplicar responsável e membros no formulário
- fechar a prévia na tela
- exibir feedback coerente (sem sucesso quando nada for aplicado)

### Consequências

✅ **Positivas:**

- Evita aplicação acidental de dados.
- Torna o processo auditável e previsível para o operador.

⚠️ **Negativas:**

- Adiciona um clique extra no fluxo.

### Alternativas Consideradas

1. Aplicação automática sem confirmação → Rejeitada: risco operacional maior.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#importação-de-portaria-da-comissão-pdf`
- Plan: `.specify/specs/001-campus-inventory/plan.md#49-contratos-da-importação-de-portaria-da-comissão`

### Alternativas Consideradas

1. Manter os botões de admin dentro do card → Rejeitada: polui a área principal de navegação.
2. Mostrar o botão de novo espaço dentro do card → Rejeitada: mistura criação com início de conferência.

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#seleção-de-espaço`
- Spec: `.specify/specs/001-campus-inventory/spec.md#consistência-de-quantitativo`
