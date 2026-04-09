# Tasks: Campus Inventory System - MVP em 4 Horas

> **Meta**: Ter API + Frontend básicos funcionais com login LDAP, lista de espaços, conferência de itens e exportação compatível.

## 🚀 Fase 0: Setup Inicial [P] (30 min)

- [x] Criar estrutura de pastas do monorepo:

  ```bash
  mkdir -p campus-inventory/{backend/src/{routes,controllers,services,middleware,prisma},frontend/src/{app,components,lib,workers},scripts}

  Inicializar pnpm-workspace.yaml na raiz:
  yaml:
  packages:
  - "frontend"
  - "backend"
  ```

Criar docker-compose.yml com serviços: backend (port 8000), frontend (port 3000), volume ./data:/app/data
Criar .gitignore ignorando node_modules, .sqlite, .env, .specify/memory

## 🔐 Fase 1: Autenticação LDAP + JWT [P] (45 min)

- [x] Backend: Instalar deps: pnpm add activedirectory2 jsonwebtoken cors dotenv
- [x] Backend: Criar src/services/ldap.js com função validateUser(sAMAccountName, password) usando activedirectory2
- [x] Backend: Criar src/middleware/auth.js com verifyJWT e requireRole
- [x] Backend: Criar rota POST /api/auth/login que:
      Valida credenciais via LDAP
      Emite JWT com { sub: samAccountName, role, fullName }
      Retorna { token, user }
- [x] Frontend: Criar página /login com formulário sAMAccountName + password
- [x] Frontend: Salvar JWT em localStorage e injetar em headers Authorization: Bearer <token>

## 🗄️ Fase 2: Prisma + SQLite + Seed [P] (45 min)

- [x] Backend: Instalar Prisma: pnpm add -D prisma @prisma/client
- [x] Backend: Criar prisma/schema.prisma com models User, Space, Item, Relocation e enums conforme plan.md
- [x] Backend: Rodar pnpm prisma migrate dev --name init para gerar dev.db
- [x] Backend: Criar script scripts/seed-xlsx.js que:
      Lê inventario.xlsx com xlsx ou exceljs
      Extrai valores únicos da coluna você digita a sala → cria Space
      Mapeia cada linha → cria Item vinculado ao Space pelo nome
      Preserva todas as colunas originais em campo rawData JSON? ou campos individuais
- [x] Backend: Adicionar rota GET /api/spaces/active retornando espaços isActive=true AND isFinalized=false

## 🧭 Fase 3: Frontend - Dashboard de Espaços (30 min)

- [x] Frontend: Criar página /dashboard protegida por auth
- [x] Frontend: Listar espaços ativos em cards: Nome | Responsável | Qtd Itens | [Iniciar Conferência]
- [x] Frontend: Ao clicar em "Iniciar Conferência", navegar para /room/[spaceId]
- [x] Frontend: Quando o usuário for ADMIN, mostrar apenas um botão flutuante `✏️` no canto superior direito do card ao passar o mouse
- [x] Frontend: Exibir o botão `📝 Novo espaço` fora do card, logo após a busca do dashboard

## 🔄 Fase 4: Tela de Conferência - Core [P] (60 min)

- [x] Backend: Criar rota GET /api/items?spaceId=:id retornando:
      Itens do espaço + relocações pendentes de confirmação
      Formato: { id, patrimonio, descricao, condicaoOriginal, statusEncontrado, condicaoVisual, meta: { isRelocated?, fromSpaceName? } }

- [x] Backend: Criar rota POST /api/items/check com debounce 1s:
      Atualiza statusEncontrado=SIM, condicaoVisual, dataConferencia, ultimoConferente
      Retorna { success, savedAt }
- [x] Frontend: Criar componente RoomHeader com: nome do espaço, responsável, progresso %, botão "Sala Finalizada"
- [x] Frontend: Criar componente ItemCard:
- [x] Estado colapsado: patrimonio | descricao curta | [✅] [🗑️]
- [x] Estado expandido: dados completos + botões [🟢] [🟡] [🔴]
- [x] Highlight visual se meta.isRelocated=true
- [x] Frontend: Implementar auto-save com debounce(1000) em cada interação
- [x] Frontend: Implementar fila offline com localforage + retry ao reconectar

## 📤 Fase 5: Exportação Compatível (20 min)

- [x] Backend: Criar rota GET /api/export/xlsx que:
      Consulta todos os Item + Space.name
      Mapeia campos internos para colunas originais do inventario.xlsx
      Gera arquivo .xlsx com mesma ordem e formatação
      Envia como Content-Disposition: attachment
      Testar: Exportar, abrir no Excel e confirmar que colunas estão intactas

Observação: a exportação foi alinhada ao template limpo [planilha_campus_aracruz_05032025.xlsx](../../../../planilha_campus_aracruz_05032025.xlsx), mantendo os campos-base do inventário e descartando as colunas acessórias da planilha antiga.

## 🧪 Fase 6: QA Rápido (10 min)

Testar fluxo completo: Login → Selecionar espaço → Confirmar 1 item → Exportar → Validar Excel
Testar realocação: Remover item de Espaço A → Realocar para Espaço B → Confirmar em B → Verificar badge e highlight
Testar offline: Desconectar rede → Confirmar item → Reconectar → Verificar sincronização

## 🎨 Fase 7: Sistema de Modais (Nova Prioridade)

- [x] Criar componente `Modal.jsx` wrapper genérico
- [x] Criar componente `ConfirmModal.jsx` para confirmações
- [x] Criar sistema de Toast com Context API
- [x] Adicionar estilos CSS com animações
- [x] **Refatorar** `room/[spaceId]/page.js`:
  - [x] Substituir `confirm()` de remoção por `ConfirmModal`
  - [x] Substituir `confirm()` de finalização por `ConfirmModal`
  - [x] Substituir `alert()` de erro por `showToast('error')`
  - [x] Substituir `alert()` de sucesso por `showToast('success')`
- [x] **Refatorar** `dashboard/page.js`:
  - [x] Substituir alerts por toasts
- [ ] Testar acessibilidade (tecla ESC, focus trap)
- [ ] Testar em mobile

## 🔍 Fase 8: Busca + CRUD de Espaços + UI Patterns

- [x] Criar componente `SpaceSearchBar` com:
  - [x] Input com debounce 300ms
  - [x] Dropdown de resultados (máx 10)
  - [x] Navegação por teclado (↑↓ Enter ESC)
  - [x] Atalho Ctrl+K para focar
- [x] Implementar endpoint `GET /api/spaces/active?q=string`
- [x] Integrar SearchBar no header do Dashboard
- [x] Restringir a busca ao nome do espaço para evitar duplicidade de resultados
- [x] O botão `📝 Novo espaço` deve ficar imediatamente após o componente de busca

### CRUD de Espaços (Admin)

- [x] Criar página `/admin/spaces` com tabela e formulário inline
- [x] Implementar endpoints REST: POST/PUT/DELETE em `/api/spaces/admin/spaces`
- [x] Validação: nome único, não desativar se tiver itens
- [x] No dashboard, permitir edição do nome via botão flutuante `✏️` ao passar o mouse no card
- [x] Atualizar modal de realocação para listar espaços `isActive=true` e espaços finalizados para permitir retorno de itens
- [x] Garantir que a contagem dos cards do dashboard use a mesma regra de visibilidade aplicada na sala

## 📊 Fase 9: Painel de Auditoria

- [x] Criar página `/admin/unfound-items` com:
  - [x] Tabela com filtros (período, espaço, conferente, ação)
  - [x] Colunas conforme especificação
  - [x] Botão "Ver Histórico" (abre modal com timeline)
  - [x] Botão "Marcar como Encontrado" (reverte status)
- [x] Implementar endpoint `GET /api/audit/unfound-items` com paginação
- [x] Criar endpoint `GET /api/items/:id/historico` para timeline
- [x] Adicionar exportação de auditoria: `GET /api/export/audit-xlsx`

## 🧩 Fase 10: Múltiplos Inventários + Acesso Autorizado

- [x] Criar entidade/tabela de inventário (ciclo) com: nome, campus, fonteDados, cicloBaseId, statusOperacao, datas e auditoria
- [x] Vincular Space/Item ao inventário ativo (`inventoryId`) para isolamento entre ciclos
- [x] Implementar endpoint `GET /api/inventories/my` retornando apenas inventários autorizados ao usuário logado
- [x] Bloquear acesso por URL direta a inventário não autorizado (retornar 403)
- [x] Criar página de painel próprio "Meus Inventários" no frontend
- [x] Atualizar navegação para seleção explícita do inventário antes do dashboard/salas

## 👥 Fase 11: Permissões por Inventário (Admin)

- [x] Criar model de vínculo `InventoryUser` com perfil por inventário: ADMIN_CICLO, CONFERENTE, REVISOR, VISUALIZADOR
- [x] Implementar aba "Permissões" visível somente para ADMIN_CICLO
- [x] Implementar busca de usuários por siape/cpf/nome na aba de permissões
- [x] Implementar fluxo de resolução de usuário:
  - [x] consultar banco local primeiro
  - [x] se não encontrar, consultar Active Directory
  - [x] ao adicionar, persistir usuário local e vínculo no inventário
- [x] Implementar remoção de usuário do inventário
- [x] Implementar alteração de perfil do usuário no inventário (incluindo VISUALIZADOR)
- [x] Aplicar autorização no backend para impedir alterações por perfil VISUALIZADOR

## ⚙️ Fase 12: Administração do Inventário (Nome + Situação)

- [x] Criar endpoint `PATCH /api/inventories/:id` para atualizar metadados do inventário
- [x] Permitir alteração de nome do inventário por ADMIN_CICLO
- [x] Permitir alteração de status operacional: Não iniciado, Pausado, Em Auditoria, Finalizado, Cancelado
- [x] Implementar regras de transição de status e bloqueios de operação por estado
- [x] Registrar histórico de mudanças de status (de/para, usuário, data/hora)
- [x] Exibir controles de edição de nome/status na aba administrativa do inventário

## 🧭 Fase 13: UX de Inventários + Criação de Ciclo + Dashboard por Abas

### Meus Inventários (Pós-Login)

- [x] Reutilizar o mesmo header visual do dashboard na página de inventários (`Campus Inventory`, subtítulo e ação `[Sair]`)
- [x] Tornar o card inteiro clicável para seleção/acesso ao inventário ativo (remover dependência de botão interno de acesso)
- [x] Garantir acessibilidade de navegação por teclado no card clicável (foco, Enter/Espaço)
- [x] Exibir CTA `Criar novo inventário` somente para perfis autorizados

### Fluxo de Criação/Gestão de Inventário

- [x] Criar página/rota de criação e gestão de inventário (ex.: `/inventories/new`)
- [x] Implementar formulário com campos obrigatórios:
  - [x] nome do inventário
  - [x] servidor responsável principal
  - [x] fonte da carga inicial (reutilizar ciclo finalizado ou upload XLSX)
  - [x] data de início e data de término
  - [x] usuários adicionais e perfis iniciais
- [x] Validar regras de consistência (`endDate >= startDate`, campos obrigatórios, base obrigatória ao reutilizar ciclo)
- [x] Implementar endpoint `POST /api/inventories` com persistência de metadados e vínculos iniciais
- [x] Garantir inclusão automática do criador como `ADMIN_CICLO`

### Dashboard do Inventário por Abas/Seções

- [x] Reorganizar a região inferior do dashboard para abas/seções administrativas
- [x] Mover acesso de auditoria para aba `Auditoria`
- [x] Integrar aba `Permissões` com a gestão já implementada na Fase 11
- [x] Criar/ajustar aba `Dados` para edição de nome, responsável, fonte, datas e status
- [x] Controlar visibilidade das abas por perfil do usuário no inventário
- [x] Unificar a nova caixa de acesso às abas com a caixa de conteúdo das abas no fim da lista de espaços
- [x] Implementar container único de abas (`header de abas + painel da aba ativa`) no dashboard
- [x] Eliminar caixas separadas de navegação e exibição das abas para reduzir fricção de acesso
- [x] Ajustar navegação responsiva das abas (desktop horizontal; mobile com acesso flexível)
- [x] Validar continuidade visual entre lista de espaços e painel administrativo de abas

### Backend de Suporte e Contratos

- [x] Implementar/ajustar `GET /api/inventories/:inventoryId` para alimentar aba `Dados`
- [x] Garantir contratos estáveis em `PATCH /api/inventories/:inventoryId` e `GET /api/inventories/:inventoryId/status-history`
- [x] Validar upload XLSX no fluxo de criação antes da carga inicial
- [x] Garantir trilha de auditoria para criação e alterações administrativas do ciclo

### QA e Regressão

- [ ] Testar fluxo completo: login → meus inventários → criar inventário → acessar dashboard por abas
- [x] Testar permissões por perfil (`ADMIN_CICLO`, `CONFERENTE`, `REVISOR`, `VISUALIZADOR`) nas abas administrativas
- [ ] Testar regressão crítica: login LDAP, listagem de inventários autorizados, seleção de inventário e acesso a sala
- [ ] Testar mobile/responsividade da nova experiência da página de inventários

## 👤 Fase 14: CRUD Geral de Usuários (Admin)

### Backend

- [x] Criar endpoint `GET /api/admin/users` com lista completa de usuários locais e vínculos por inventário
- [x] Adicionar filtro de busca local por `fullName` (CN) e `samAccountName` (siape)
- [x] Criar endpoint `POST /api/admin/users/:userId/inventories` para adicionar usuário em inventário com perfil
- [x] Criar endpoint `PATCH /api/admin/users/:userId/inventories/:inventoryId` para alterar perfil no inventário
- [x] Criar endpoint `DELETE /api/admin/users/:userId/inventories/:inventoryId` para remover vínculo
- [x] Restringir CRUD geral a perfis administrativos autorizados
- [x] Garantir que o login atualize sempre `fullName` local com o CN retornado pelo LDAP
- [x] Resolver identidade no AD com bind técnico e filtro explícito por `sAMAccountName`, `employeeID`, `uid`, `cn` e `displayName`
- [x] Garantir que a busca de CN depende de `LDAP_BIND_USER` e `LDAP_BIND_PASS` carregados no container do backend

### Frontend

- [x] Criar página de gerenciamento global de usuários
- [x] Exibir card por usuário com `CN` e `sAMAccountName`
- [x] Renderizar badges de inventários vinculados dentro do card
- [x] Mostrar ícone `x` na badge ao passar o mouse
- [x] Exibir modal de confirmação antes de remover vínculo via badge
- [x] Adicionar botão `add` no card para inclusão em inventário
- [x] Implementar seleção de inventário + perfil no fluxo de inclusão
- [x] Integrar toasts de sucesso/erro para adicionar/remover/alterar vínculo

### QA

- [x] Validar remoção de vínculo por badge com confirmação
- [x] Validar inclusão de usuário em inventário com perfil correto
- [x] Validar edição de perfil do usuário por inventário
- [x] Validar busca local por CN e siape no CRUD geral
- [x] Validar que o login de `1918648` persiste `fullName = Renan Campagnaro Soprani`
- [x] Validar que a listagem administrativa exibe o `CN` persistido, e não o siape, quando o AD retorna o nome completo

## 🧾 Fase 15: Importação de Portaria da Comissão (PDF + SIAPE Estrito)

### Backend

- [x] Adicionar endpoint `POST /api/inventories/commission/parse` para processar PDF da portaria
- [x] Extrair membros da comissão por linha (`nome + matrícula SIAPE`)
- [x] Definir responsável com prioridade para marcação explícita (presidente/responsável/coordenador)
- [x] Aplicar fallback para primeiro nome extraído quando não houver declaração clara de responsável
- [x] Resolver usuários no AD por SIAPE com unicidade obrigatória
- [x] Expandir resolução exata de SIAPE para `employeeID`, `sAMAccountName` e `uid`
- [x] Enriquecer retorno de nome completo via busca complementar por `sAMAccountName` quando necessário
- [x] Retornar estrutura de prévia com `owner`, `members`, `unresolvedNames` e `extractedMembers`

### Frontend

- [x] Adicionar upload de PDF da portaria na página `/inventories/new`
- [x] Exibir prévia antes de aplicar dados no formulário
- [x] Implementar confirmação explícita (`Confirmar importação da portaria`) antes de preencher responsável e membros
- [x] Corrigir aplicação no formulário para fallback de responsável quando `owner` vier vazio na prévia
- [x] Fechar a prévia de importação após clicar em confirmar
- [x] Ajustar feedback para não exibir sucesso quando nenhum dado válido for aplicado

### QA

- [x] Validar resolução por SIAPE para casos reais (incluindo `1918648`, `2329133`, `1681989`)
- [x] Validar que nomes antes não resolvidos entram na prévia quando o SIAPE tem correspondência única no AD
- [x] Validar preenchimento do formulário de criação de inventário após confirmação da importação

## 🎯 Critérios de Aceite do MVP

Login LDAP funciona com usuário real da instituição
Lista de espaços exibe apenas ativos e não finalizados
Card de item expande/colapsa com clique no corpo
Botões de conservação atualizam condicaoVisual e salvam automaticamente
Realocação mostra badge visual e requer confirmação no destino
Exportação gera arquivo compatível com o template limpo da planilha nova
App funciona em mobile (PWA responsivo)

## ✅ Critérios de Aceite - Expansão de Inventários

Usuário comum visualiza apenas inventários autorizados no painel próprio
Inventário não autorizado não é acessível por URL direta
Admin do inventário consegue adicionar/remover usuários e ajustar perfis
Busca de usuário em permissões aceita siape/cpf/nome
Se usuário não existir no banco local, sistema consulta AD e cria cadastro ao adicionar
Perfil VISUALIZADOR consegue consultar dados sem permissão de edição
Admin do inventário consegue alterar nome e status operacional
Mudanças de status ficam registradas em histórico de auditoria
