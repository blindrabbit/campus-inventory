# Execution Report: Campus Inventory MVP

Data da validação: 2026-06-16

## Resumo

O checklist foi atualizado apenas para itens com evidência no código do repositório. Além das fases iniciais do MVP, também estão implementadas no estado atual as fases de múltiplos inventários, permissões por inventário, administração de status/metadados, UX de inventários por abas, CRUD global de usuários, importação de portaria da comissão por PDF com resolução estrita por SIAPE, movimentação planejada em lote, importação de acervo bibliográfico por código de barras e melhorias de busca/modo leitura. Permanecem pendentes os testes manuais finais de QA/acessibilidade/mobile.

## Itens validados como executados

### Fase 1: Autenticação LDAP + JWT

Implementado em [backend/src/services/ldap.js](backend/src/services/ldap.js), [backend/src/middleware/auth.js](backend/src/middleware/auth.js), [backend/src/routes/auth.routes.js](backend/src/routes/auth.routes.js) e [frontend/src/app/login/page.js](frontend/src/app/login/page.js).

### Fase 2: Prisma + SQLite + Seed

Implementado em [backend/prisma/schema.prisma](backend/prisma/schema.prisma), [backend/prisma/migrations/20260408135147_add_item_history_and_search_fields/migration.sql](backend/prisma/migrations/20260408135147_add_item_history_and_search_fields/migration.sql), [backend/scripts/seed-xlsx.js](backend/scripts/seed-xlsx.js), [backend/src/routes/space.routes.js](backend/src/routes/space.routes.js), [docker-compose.yml](docker-compose.yml) e [pnpm-workspace.yaml](pnpm-workspace.yaml).

### Fase 3: Dashboard de Espaços

Implementado em [frontend/src/app/dashboard/page.js](frontend/src/app/dashboard/page.js) e apoiado por [frontend/src/components/SpaceSearchBar/SpaceSearchBar.jsx](frontend/src/components/SpaceSearchBar/SpaceSearchBar.jsx).

### Fase 4: Tela de Conferência

Implementado em [backend/src/routes/item.routes.js](backend/src/routes/item.routes.js), [frontend/src/app/room/[spaceId]/page.js](frontend/src/app/room/[spaceId]/page.js) e [frontend/src/lib/syncQueue.js](frontend/src/lib/syncQueue.js).

Observação: os blocos de cabeçalho e card da sala existem na própria page da rota, não como componentes separados `RoomHeader` e `ItemCard`.

### Fase 7: Modais, Toasts e refatorações associadas

Implementado em [frontend/src/components/Modal/Modal.jsx](frontend/src/components/Modal/Modal.jsx), [frontend/src/components/ConfirmModal/ConfirmModal.jsx](frontend/src/components/ConfirmModal/ConfirmModal.jsx), [frontend/src/components/Modal/modal.css](frontend/src/components/Modal/modal.css), [frontend/src/components/Toast/toastContext.js](frontend/src/components/Toast/toastContext.js), [frontend/src/app/layout.js](frontend/src/app/layout.js), [frontend/src/app/room/[spaceId]/page.js](frontend/src/app/room/[spaceId]/page.js) e [frontend/src/app/dashboard/page.js](frontend/src/app/dashboard/page.js).

### Fase 8: Busca + CRUD de Espaços

Implementado em [frontend/src/components/SpaceSearchBar/SpaceSearchBar.jsx](frontend/src/components/SpaceSearchBar/SpaceSearchBar.jsx), [frontend/src/app/admin/spaces/page.js](frontend/src/app/admin/spaces/page.js) e [backend/src/routes/space.routes.js](backend/src/routes/space.routes.js).

### Fase 9: Painel de Auditoria

Implementado em [frontend/src/app/admin/unfound-items/page.js](frontend/src/app/admin/unfound-items/page.js), [backend/src/routes/audit.routes.js](backend/src/routes/audit.routes.js) e [backend/src/routes/export.routes.js](backend/src/routes/export.routes.js).

### Fase 10: Múltiplos Inventários + Acesso Autorizado

Implementado em [backend/prisma/schema.prisma](backend/prisma/schema.prisma), [backend/src/middleware/inventory.js](backend/src/middleware/inventory.js), [backend/src/routes/inventory.routes.js](backend/src/routes/inventory.routes.js), [frontend/src/app/inventories/page.js](frontend/src/app/inventories/page.js), [frontend/src/app/dashboard/page.js](frontend/src/app/dashboard/page.js) e [frontend/src/app/room/[spaceId]/page.js](frontend/src/app/room/[spaceId]/page.js).

### Fase 11: Permissões por Inventário

Implementado em [backend/src/routes/inventory.routes.js](backend/src/routes/inventory.routes.js), [backend/src/services/ldap.js](backend/src/services/ldap.js) e integrações no dashboard em [frontend/src/app/dashboard/page.js](frontend/src/app/dashboard/page.js).

### Fase 12: Administração do Inventário (Nome + Situação)

Implementado em [backend/src/routes/inventory.routes.js](backend/src/routes/inventory.routes.js), incluindo histórico de mudanças de status, e no frontend em [frontend/src/app/dashboard/page.js](frontend/src/app/dashboard/page.js) e [frontend/src/app/inventories/page.js](frontend/src/app/inventories/page.js).

Observação: o status `EM_EXECUCAO` está contemplado no backend e refletido na interface.

### Fase 13: UX de Inventários + Criação de Ciclo + Dashboard por Abas

Implementado em [frontend/src/app/inventories/page.js](frontend/src/app/inventories/page.js), [frontend/src/app/inventories/new/page.js](frontend/src/app/inventories/new/page.js), [frontend/src/app/dashboard/page.js](frontend/src/app/dashboard/page.js) e contratos correspondentes em [backend/src/routes/inventory.routes.js](backend/src/routes/inventory.routes.js).

Inclui badge do inventário ativo (nome/ID/status), ação de troca de inventário e recarga automática quando o inventário ativo muda.

### Fase 14: CRUD Geral de Usuários (Admin)

Implementado em [backend/src/routes/admin.routes.js](backend/src/routes/admin.routes.js), [backend/src/routes/auth.routes.js](backend/src/routes/auth.routes.js), [backend/src/services/ldap.js](backend/src/services/ldap.js) e [frontend/src/app/admin/users/page.js](frontend/src/app/admin/users/page.js).

Validação funcional observada: login atualiza `fullName` local com CN do AD e listagem administrativa exibe CN persistido.

### Fase 15: Importação de Portaria da Comissão (PDF + SIAPE Estrito)

Implementado em [backend/src/routes/inventory.routes.js](backend/src/routes/inventory.routes.js), [backend/src/services/ldap.js](backend/src/services/ldap.js) e [frontend/src/app/inventories/new/page.js](frontend/src/app/inventories/new/page.js).

Inclui:

- parse de PDF de portaria
- extração de `nome + matrícula SIAPE`
- resolução no AD por SIAPE exato e único (`employeeID`, `sAMAccountName`, `uid`)
- fallback de responsável para o primeiro nome quando não houver indicação explícita
- prévia + confirmação explícita antes de aplicar no formulário
- fechamento da prévia após confirmação

### Fase 5: Exportação Compatível

Implementado em [backend/src/routes/export.routes.js](backend/src/routes/export.routes.js). A nova rota [GET /api/export/xlsx](backend/src/routes/export.routes.js) gera a planilha no formato limpo baseado em [planilha_campus_aracruz_05032025.xlsx](../../planilha_campus_aracruz_05032025.xlsx).

### Fase 17: Movimentação Planejada e Menu Administrativo

Implementado em [backend/src/routes/item.routes.js](backend/src/routes/item.routes.js), [backend/src/routes/audit.routes.js](backend/src/routes/audit.routes.js), [frontend/src/app/dashboard/movimentacoes/page.js](frontend/src/app/dashboard/movimentacoes/page.js), [frontend/src/app/dashboard/page.js](frontend/src/app/dashboard/page.js) e [backend/test/item-relocate.route.test.js](backend/test/item-relocate.route.test.js).

Inclui:

- endpoint `POST /api/items/planned-relocations`
- execução transacional de múltiplos pares `item + sala destino`
- permissão para `ADMIN`/`ADMIN_CICLO`
- justificativa obrigatória quando há sala lacrada
- histórico nas salas origem/destino via `ItemHistorico`
- SSE e recomputação de contadores
- tela `/dashboard/movimentacoes`
- menu administrativo colapsável no dashboard com `Movimentações`, `Acompanhamento`, `Auditoria`, `Usuários`, `Dados`, `Backups` e `Relatório de Eventos`

### Fase 18: Acervo Bibliográfico, Busca por Código de Barras e Modo Leitura

Implementado em [backend/src/routes/item.routes.js](backend/src/routes/item.routes.js), [backend/prisma/schema.prisma](backend/prisma/schema.prisma), [backend/prisma/migrations/20260616170000_partial_patrimonio_unique_for_books/migration.sql](backend/prisma/migrations/20260616170000_partial_patrimonio_unique_for_books/migration.sql), [backend/scripts/seed-xlsx.js](backend/scripts/seed-xlsx.js), [backend/scripts/seed-books-xlsx.js](backend/scripts/seed-books-xlsx.js), [frontend/src/app/room/[spaceId]/page.js](frontend/src/app/room/[spaceId]/page.js) e [frontend/src/components/ScanningModal/ScanningModeModal.jsx](frontend/src/components/ScanningModal/ScanningModeModal.jsx).

Inclui:

- importação de livros por cabeçalho de XLSX
- `exemplar`/`codigoBarras` como chave principal do acervo
- suporte a livros sem patrimônio
- índice parcial para preservar patrimônio único em itens comuns sem `codigo_barras`
- busca manual por patrimônio, código de barras, RFID, descrição e autores
- exibição de código de barras/RFID nos resultados
- estado visual claro de “Item não encontrado” no modo leitura, mantendo foco para nova tentativa

Validação específica no arquivo `kellyra_2026-06-12-17-19-44.xlsx`:

- `10.336` linhas totais
- `10.336` linhas processáveis pela nova regra
- `0` linhas puladas por falta de identificador
- `10.336` códigos de barras/exemplares únicos
- `5.309` registros com patrimônio
- `5.027` registros sem patrimônio

## Validações automatizadas recentes

- `DATABASE_URL=postgresql://user:pass@localhost:5432/db ./backend/node_modules/.bin/prisma validate --schema backend/prisma/schema.prisma`: passou.
- `node --test` no backend: passou.
- `./node_modules/.bin/next build` no frontend: passou.

## Pendências confirmadas

- Os testes manuais de QA rápido não foram executados aqui.
- Os testes de acessibilidade e mobile da fase 7 não foram validados por evidência automatizada no repositório.
- O fluxo E2E completo de criação por portaria (upload real de PDF, confirmação e criação final do inventário) ainda depende de validação manual em interface.

## Observação de consistência

O checklist em [tasks.md](tasks.md) foi marcado com base na implementação efetiva encontrada no código, e não apenas na descrição original das tasks.
