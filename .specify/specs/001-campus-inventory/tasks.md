# Tasks: Campus Inventory System - MVP em 4 Horas

> **Meta**: Ter API + Frontend básicos funcionais com login LDAP, lista de espaços, conferência de itens e exportação compatível.

## 🚀 Fase 0: Setup Inicial [P] (30 min)

- [ ] Criar estrutura de pastas do monorepo:

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

Backend: Instalar deps: pnpm add activedirectory2 jsonwebtoken cors dotenv
Backend: Criar src/services/ldap.js com função validateUser(sAMAccountName, password) usando activedirectory2
Backend: Criar src/middleware/auth.js com verifyJWT e requireRole
Backend: Criar rota POST /api/auth/login que:
Valida credenciais via LDAP
Emite JWT com { sub: samAccountName, role, fullName }
Retorna { token, user }
Frontend: Criar página /login com formulário sAMAccountName + password
Frontend: Salvar JWT em localStorage e injetar em headers Authorization: Bearer <token>

## 🗄️ Fase 2: Prisma + SQLite + Seed [P] (45 min)

Backend: Instalar Prisma: pnpm add -D prisma @prisma/client
Backend: Criar prisma/schema.prisma com models User, Space, Item, Relocation e enums conforme plan.md
Backend: Rodar pnpm prisma migrate dev --name init para gerar dev.db
Backend: Criar script scripts/seed-xlsx.js que:
Lê inventario.xlsx com xlsx ou exceljs
Extrai valores únicos da coluna você digita a sala → cria Space
Mapeia cada linha → cria Item vinculado ao Space pelo nome
Preserva todas as colunas originais em campo rawData JSON? ou campos individuais
Backend: Adicionar rota GET /api/spaces/active retornando espaços isActive=true AND isFinalized=false

## 🧭 Fase 3: Frontend - Dashboard de Espaços (30 min)

Frontend: Criar página /dashboard protegida por auth
Frontend: Listar espaços ativos em cards: Nome | Responsável | Qtd Itens | [Iniciar Conferência]
Frontend: Ao clicar em "Iniciar Conferência", navegar para /room/[spaceId]

## 🔄 Fase 4: Tela de Conferência - Core [P] (60 min)

Backend: Criar rota GET /api/items?spaceId=:id retornando:
Itens do espaço + relocações pendentes de confirmação
Formato: { id, patrimonio, descricao, condicaoOriginal, statusEncontrado, condicaoVisual, meta: { isRelocated?, fromSpaceName? } }
Backend: Criar rota POST /api/items/check com debounce 1s:
Atualiza statusEncontrado=SIM, condicaoVisual, dataConferencia, ultimoConferente
Retorna { success, savedAt }
Frontend: Criar componente RoomHeader com: nome do espaço, responsável, progresso %, botão "Sala Finalizada"
Frontend: Criar componente ItemCard:
Estado colapsado: patrimonio | descricao curta | [✅] [🗑️]
Estado expandido: dados completos + botões [🟢] [🟡] [🔴]
Highlight visual se meta.isRelocated=true
Frontend: Implementar auto-save com debounce(1000) em cada interação
Frontend: Implementar fila offline com localforage + retry ao reconectar

## 📤 Fase 5: Exportação Compatível (20 min)

Backend: Criar rota GET /api/export/xlsx que:
Consulta todos os Item + Space.name
Mapeia campos internos para colunas originais do inventario.xlsx
Gera arquivo .xlsx com mesma ordem e formatação
Envia como Content-Disposition: attachment
Testar: Exportar, abrir no Excel e confirmar que colunas estão intactas

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

## 🎯 Critérios de Aceite do MVP

Login LDAP funciona com usuário real da instituição
Lista de espaços exibe apenas ativos e não finalizados
Card de item expande/colapsa com clique no corpo
Botões de conservação atualizam condicaoVisual e salvam automaticamente
Realocação mostra badge visual e requer confirmação no destino
Exportação gera arquivo compatível com inventario.xlsx original
App funciona em mobile (PWA responsivo)
