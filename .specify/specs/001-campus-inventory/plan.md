# Technical Plan: Campus Inventory System

## 1. Technology Stack

- **Frontend**: Next.js 14 (App Router, React Server Components, TailwindCSS, shadcn/ui)
- **Backend**: Express.js (API REST, Node 20+ LTS)
- **Database**: SQLite 3 via Prisma ORM (type-safe, migrations automáticas)
- **Auth**: `activedirectory2` (LDAP/AD bind via `sAMAccountName`), `jsonwebtoken` para sessão
- **Sync/Offline**: `localforage` (IndexedDB), Service Worker + Workbox, fila de requisições
- **Package Manager**: pnpm (monorepo com `pnpm-workspace.yaml`)
- **Deploy**: Docker Compose local, volumes persistentes para `sqlite.db`

## 2. Project Structure

campus-inventory/
├── .specify/
├── backend/
│ ├── src/
│ │ ├── routes/ # Express routers (auth, spaces, items, export)
│ │ ├── controllers/ # Business logic
│ │ ├── services/ # LDAP, Excel parser, sync queue
│ │ ├── middleware/ # Auth JWT, role guard
│ │ └── prisma/ # schema.prisma, migrations
│ ├── package.json
│ └── Dockerfile
├── frontend/
│ ├── src/
│ │ ├── app/ # Next.js pages (login, dashboard, room, review)
│ │ ├── components/ # Cards, modals, offline indicator
│ │ ├── lib/ # API client, auth context, sync queue
│ │ └── workers/ # service-worker.js
│ ├── package.json
│ └── Dockerfile
├── pnpm-workspace.yaml
└── docker-compose.yml

### 2.1 LDAP de Identidade e Sincronização de Nome

- O backend usa bind técnico do AD para qualquer consulta de identidade de usuário.
- O retorno confiável para nome completo vem de uma busca explícita no AD, não de um lookup genérico por login.
- A resolução validada para o nome do usuário deve consultar o objeto do AD por filtro amplo, considerando `sAMAccountName`, `employeeID`, `uid`, `cn` e `displayName`.
- O `fullName` persistido localmente deve receber o `CN`/`displayName` retornado pelo AD.
- O `sAMAccountName` continua sendo o identificador canônico de login; ele não deve substituir o nome de exibição no banco nem na interface.
- Alterações em `LDAP_BIND_USER` e `LDAP_BIND_PASS` exigem recriação do container do backend para entrarem no processo em execução.
- Para importação de comissão por portaria, a resolução por SIAPE deve aceitar correspondência exata única considerando `employeeID`, `sAMAccountName` e `uid`.
- Quando a consulta exata por SIAPE retornar atributos incompletos, a estratégia deve enriquecer o registro por busca adicional via `sAMAccountName` para recuperar `CN`/`displayName`.

## 3. Data Model (Prisma)

```prisma
model User {
  id             String   @id @default(cuid())
  samAccountName String   @unique
  fullName       String
  role           Role     @default(CONFERENTE)
  createdAt      DateTime @default(now())
}

model Space {
  id            String   @id @default(cuid())
  name          String
  responsible   String
  isActive      Boolean  @default(true)
  isFinalized   Boolean  @default(false)
  items         Item[]
  relocationOut Relocation[] @relation("RelocationSource")
}

model Item {
  id                String    @id @default(cuid())
  patrimonio        String    @unique
  descricao         String
  valor             Decimal?
  condicaoOriginal  String
  fornecedor        String?
  codigoSIA         String?
  dataAquisicao     DateTime?
  documento         String?
  tipoAquisicao     String?

  spaceId           String
  space             Space     @relation(fields: [spaceId], references: [id])

  statusEncontrado  StatusConf @default(NAO)
  condicaoVisual    CondicaoVis?
  dataConferencia   DateTime?
  ultimoConferente  String?

  relocationIn      Relocation? @relation("RelocationTarget")
}
```

## 7. Arquitetura de Realocação em Tempo Real

### Modelo de Dados Atualizado

**Tabela `ItemHistorico`**

```prisma
model ItemHistorico {
  id              String   @id @default(cuid())
  itemId          String
  item            Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)

  fromSpaceId     String?
  fromSpace       Space?   @relation("HistoricoFrom", fields: [fromSpaceId], references: [id])

  toSpaceId       String?
  toSpace         Space?   @relation("HistoricoTo", fields: [toSpaceId], references: [id])

  action          HistoricoAction
  reason          String?  @db.Text
  metadata        Json?    // Dados adicionais (ex: justificativa)

  createdBy       String   // samAccountName
  createdAt       DateTime @default(now())

  @@map("item_historico")
  @@index([itemId, createdAt])
  @@index([fromSpaceId, createdAt])
  @@index([toSpaceId, createdAt])
}

enum HistoricoAction {
  CRIADO
  REALOCADO
  NAO_LOCALIZADO
  ENCONTRADO
  ESTORNADO
  EXCLUIDO
}
enum Role { ADMIN, CONFERENTE, VISUALIZADOR }
enum StatusConf { SIM, NAO, PENDENTE }
enum CondicaoVis { EXCELENTE, BOM, INSERVIVEL }

```

## 4. API Contracts (Express)

POST /api/auth/login → { sAMAccountName, password } → LDAP bind → JWT
GET /api/spaces/active → Lista espaços não finalizados
GET /api/items?spaceId=:id → Retorna itens com status e relocações pendentes
POST /api/items/check → { itemId, condicao } → Atualiza statusEncontrado=SIM, debounce 1s
POST /api/items/relocate → { itemId, targetSpaceId } → Cria registro Relocation com flag pendingConfirm
POST /api/items/unfound → { itemId } → statusEncontrado=NAO, remove da lista ativa
POST /api/spaces/:id/finalize → Bloqueia espaço, gera log de auditoria

## 4.1. Contratos de Permissão por Inventário (Fase 11)

GET /api/inventories/:inventoryId/permissions → Lista usuários vinculados ao inventário
GET /api/inventories/:inventoryId/permissions/search?q=... → Busca usuário (banco local primeiro; fallback AD)
POST /api/inventories/:inventoryId/permissions → Adiciona vínculo do usuário ao inventário
PATCH /api/inventories/:inventoryId/permissions/:userId → Atualiza perfil no inventário
DELETE /api/inventories/:inventoryId/permissions/:userId → Remove vínculo do inventário

Perfis aceitos: ADMIN_CICLO, CONFERENTE, REVISOR, VISUALIZADOR.

## 4.2. Guardrails de Regressão Funcional

- Não alterar contrato público de endpoints já consumidos pelo frontend sem compatibilidade reversa.
- `POST /api/auth/login` deve diferenciar:
  - validação de entrada (400)
  - credencial inválida (401)
  - indisponibilidade LDAP (503)
  - erro interno (500)
- O parser JSON do Express deve permanecer operacional após qualquer update de dependência/container.
- Regras de escrita devem passar por middleware de autorização por inventário (ex.: bloquear `VISUALIZADOR` em endpoints de alteração).
- Alterações em permissões devem ser auditáveis e idempotentes quando possível (`upsert` para vínculo).

## 4.3. Contratos da Nova Experiência de Inventários (Fase 13)

GET /api/inventories/my → Lista inventários autorizados para o usuário atual (cards totalmente clicáveis no frontend)
POST /api/inventories → Cria novo inventário com dados mínimos de gestão e configuração inicial
GET /api/inventories/:inventoryId → Retorna metadados completos para aba `Dados` (nome, responsável, fonte, datas, status)
PATCH /api/inventories/:inventoryId → Atualiza metadados e status operacional (com validações de transição)
GET /api/inventories/:inventoryId/permissions → Lista permissões por usuário para renderização da aba `Permissões`
GET /api/inventories/:inventoryId/status-history → Histórico de mudanças de estado para timeline administrativa

Payload mínimo para criação (`POST /api/inventories`):

```json
{
  "name": "Inventário Campus Aracruz 2026",
  "ownerUserId": "cm123...",
  "dataSource": "REUSE_BASE|UPLOAD_XLSX",
  "baseInventoryId": "cm456...",
  "startDate": "2026-04-09",
  "endDate": "2026-06-30",
  "initialMembers": [
    { "userId": "cm789...", "role": "CONFERENTE" },
    { "userId": "cm999...", "role": "VISUALIZADOR" }
  ]
}
```

Regras obrigatórias:

- `name`, `ownerUserId`, `dataSource`, `startDate` são obrigatórios.
- `endDate` não pode ser anterior a `startDate`.
- `baseInventoryId` é obrigatório quando `dataSource=REUSE_BASE`.
- Para `UPLOAD_XLSX`, o arquivo deve ser validado antes da criação efetiva do ciclo.
- Usuário criador deve ser incluído como `ADMIN_CICLO` no inventário criado.

## 4.4. Contratos do CRUD Geral de Usuários

GET /api/admin/users → Lista usuários locais com inventários vinculados e respectivos perfis
GET /api/admin/users?search=... → Busca usuários locais por CN (`fullName`) e siape (`samAccountName`)
POST /api/admin/users/:userId/inventories → Vincula usuário a inventário com perfil informado
PATCH /api/admin/users/:userId/inventories/:inventoryId → Altera perfil do usuário no inventário
DELETE /api/admin/users/:userId/inventories/:inventoryId → Remove vínculo do usuário no inventário

Regras obrigatórias:

- CRUD geral disponível apenas para perfis administrativos autorizados.
- Operações devem atuar somente sobre usuários já existentes no banco local.
- Remoção de vínculo deve exigir confirmação no frontend.
- A listagem deve retornar estrutura pronta para card com badges por inventário.

Payload sugerido para listagem (`GET /api/admin/users`):

```json
[
  {
    "userId": "cm123...",
    "samAccountName": "1918648",
    "fullName": "Renan Campos",
    "globalRole": "CONFERENTE",
    "inventories": [
      {
        "inventoryId": "cmInv1...",
        "inventoryName": "Inventário Campus 2026",
        "role": "REVISOR"
      }
    ]
  }
]
```

### 4.4.1 Regra de Resolução do CN para o CRUD Geral

- A listagem administrativa deve partir do `fullName` salvo no banco local.
- Se o `fullName` ainda estiver igual ao `sAMAccountName` após um login LDAP, a próxima sincronização deve consultar o AD e substituir pelo `CN`/`displayName` real.
- A regra de busca validada usa filtros explícitos no AD e não deve voltar para a abordagem de `findUser` genérica quando o objetivo for recuperar nome de exibição.
- Caso o AD não devolva `CN`/`displayName`, o sistema deve preservar o último nome local válido em vez de regravar o siape como nome.

## 4.5. Etapas de Execução da Fase 13

1. Estruturar IA da tela `Meus Inventários` para usar header padrão do dashboard e card com clique integral.
2. Implementar fluxo de criação de inventário com validação de formulário e seleção da fonte de dados.
3. Integrar dashboard inferior por abas (`Auditoria`, `Permissões`, `Dados`) com controle por perfil no inventário.
   - Unificar a caixa de acesso das abas e a caixa de conteúdo em um único container de navegação/painel.
   - Garantir que o fim da lista de espaços já entregue o seletor de abas junto do conteúdo ativo, sem separar em blocos distintos.
   - Definir adaptação responsiva para acesso flexível às abas em desktop e mobile.
4. Reaproveitar endpoints já existentes (permissões, status, histórico) e completar contratos faltantes de criação/detalhe.
5. Executar bateria de regressão funcional em login, seleção de inventário, dashboard e rotas de sala.

## 4.6. Etapas de Execução do CRUD Geral de Usuários

1. Criar página de administração global de usuários com listagem paginável/filtrável por CN e siape.
2. Renderizar card por usuário com badges de inventários vinculados.
3. Implementar remoção de badge com exibição de ícone `x` em hover e confirmação por modal.
4. Implementar ação `add` no card para inclusão do usuário em inventário com escolha de perfil.
5. Integrar endpoints de vínculo (`POST`, `PATCH`, `DELETE`) com atualização otimista e toasts de sucesso/erro.
6. Garantir que o login atualize sempre `fullName` local a partir do CN do LDAP.

## 4.7. Diretriz de UI para Container Único de Abas

- O dashboard deve usar um componente único para administração do inventário, contendo:
  - barra de abas (gatilhos de navegação)
  - painel da aba ativa (conteúdo dinâmico)
- O componente deve ser inserido ao final da listagem de espaços, preservando continuidade visual da página.
- O estado da aba ativa deve ser centralizado no container, evitando duplicidade de controle em elementos externos.
- A solução deve reduzir fricção de navegação entre seção operacional (salas) e seção administrativa (abas), com foco em acesso rápido.

## 4.8. Evidência de Validação LDAP

- Teste atômico executado dentro do backend com os binds da aplicação confirmou que a consulta ampla no AD para `1918648` retorna:
  - `sAMAccountName = 1918648`
  - `cn = Renan Campagnaro Soprani`
  - `displayName = Renan Campagnaro Soprani`
  - `userPrincipalName = 1918648@cefetes.br`
- O mesmo teste mostrou que o caminho de consulta precisa ser executado com o bind efetivamente presente dentro do container do backend.

## 4.9. Contratos da Importação de Portaria da Comissão

POST /api/inventories/commission/parse → Recebe PDF da portaria e retorna prévia de responsável, membros resolvidos e nomes não resolvidos

Payload de entrada:

```http
multipart/form-data
commissionPdf=<arquivo.pdf>
```

Payload de saída esperado:

```json
{
  "success": true,
  "owner": {
    "userId": "cm123...",
    "samAccountName": "1918648",
    "fullName": "Renan Campagnaro Soprani",
    "existsLocally": true,
    "siape": "1918648"
  },
  "members": [
    {
      "userId": "cm456...",
      "samAccountName": "2329133",
      "fullName": "Luzimar Elias Dalfior",
      "existsLocally": true,
      "siape": "2329133",
      "role": "CONFERENTE"
    }
  ],
  "unresolvedNames": [],
  "extractedMembers": [{ "fullName": "Nome da Portaria", "siape": "1234567" }]
}
```

Regras obrigatórias:

- Extração usa linhas de texto da portaria com `matrícula SIAPE`.
- Responsável do inventário:
  - preferir linha com marca explícita de função (presidente/responsável/coordenador)
  - fallback para o primeiro nome válido extraído quando não houver indicação explícita
- Resolução no AD somente por SIAPE exato e único.
- Sem correspondência única: incluir em `unresolvedNames`.
- Frontend deve aplicar dados somente após confirmação explícita da prévia.
- Após confirmar, a prévia deve ser fechada para evitar reaplicação acidental.

## 5. Key Algorithms & Logic

Excel Fidelity: Parser xlsx lê/gera mantendo ordem exata das colunas. Mapeia você digita a sala para space.name.
Offline Sync: Filha requisições falhas em IndexedDB. Ao reconectar, processa FIFO com idempotência (verifica updatedAt para evitar race conditions).
Highlight Realocação: Items com Relocation.pendingConfirm=true retornam com meta: { isRelocated: true, fromSpaceName }. Frontend aplica classe CSS bg-yellow-100 border-l-4 border-yellow-500.

## 6. Deployment Strategy

docker-compose.yml sobe frontend (port 3000) e backend (port 8000).
SQLite montado em volume Docker: ./data:/app/data.
Seed inicial: Script node backend/scripts/seed-xlsx.js lê inventario.xlsx e popula DB.

## 7. Componentes de UI - Modal System

### Estrutura de Pastas

frontend/src/components/
├── Modal/
│ ├── Modal.jsx # Wrapper genérico
│ ├── ModalHeader.jsx
│ ├── ModalBody.jsx
│ ├── ModalFooter.jsx
│ └── modal.css # Estilos com animações
├── ConfirmModal/
│ └── ConfirmModal.jsx # Modal especializado para confirmações
└── Toast/
├── Toast.jsx
├── ToastContainer.jsx
└── toastContext.js # Context API para gerenciar toasts

## 8. Arquitetura de Realocação em Tempo Real

### Modelo de Dados Atualizado

**Tabela `ItemHistorico`**

```prisma
model ItemHistorico {
  id              String   @id @default(cuid())
  itemId          String
  item            Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)

  fromSpaceId     String?
  fromSpace       Space?   @relation("HistoricoFrom", fields: [fromSpaceId], references: [id])

  toSpaceId       String?
  toSpace         Space?   @relation("HistoricoTo", fields: [toSpaceId], references: [id])

  action          HistoricoAction
  reason          String?  @db.Text
  metadata        Json?    // Dados adicionais (ex: justificativa)

  createdBy       String   // samAccountName
  createdAt       DateTime @default(now())

  @@map("item_historico")
  @@index([itemId, createdAt])
  @@index([fromSpaceId, createdAt])
  @@index([toSpaceId, createdAt])
}

enum HistoricoAction {
  CRIADO
  REALOCADO
  NAO_LOCALIZADO
  ENCONTRADO
  ESTORNADO
  EXCLUIDO
}
```

### API dos Componentes

**Modal.jsx:**

```javascript
<Modal
  isOpen={boolean}
  onClose={function}
  title="string"
  size="sm|md|lg"  // opcional, default: md
>
  <ModalBody>...</ModalBody>
  <ModalFooter>
    <Button variant="secondary">Cancelar</Button>
    <Button variant="primary">Confirmar</Button>
  </ModalFooter>
</Modal>
```

**ConfirmModal.jsx:**

```javascript
<ConfirmModal
  isOpen={boolean}
  onConfirm={function}
  onCancel={function}
  title="string"
  message="string"
  confirmText="Confirmar"  // opcional
  cancelText="Cancelar"     // opcional
  variant="danger|warning|info"  // opcional, default: info
/>
```

**Toast (via Context):**

```javascript
// Em qualquer componente:
import { useToast } from "@/components/Toast/toastContext";

const { showToast } = useToast();

showToast({
  type: "success|error|info|warning",
  title: "string",
  message: "string",
  duration: 3000, // opcional, default: 3000ms
});
```

Substituições Necessárias

Local
De
Para
frontend/src/app/room/[spaceId]/page.js
window.confirm()
<ConfirmModal />

frontend/src/app/room/[spaceId]/page.js
window.alert()
showToast()

frontend/src/app/dashboard/page.js
window.alert()
showToast()

## 🔍 Fase 9: Busca + CRUD de Espaços + UI Patterns

### Busca de Espaços

- [ ] Criar componente `SpaceSearchBar` com:
  - [ ] Input com debounce 300ms
  - [ ] Dropdown de resultados (máx 10)
  - [ ] Navegação por teclado (↑↓ Enter ESC)
  - [ ] Atalho Ctrl+K para focar
- [ ] Implementar endpoint `GET /api/spaces/active?q=string`
- [ ] Integrar SearchBar no header do Dashboard
- [ ] Busca deve considerar apenas o nome do espaço para evitar duplicidade de resultados

### CRUD de Espaços (Admin)

- [ ] Criar página `/admin/spaces` com tabela e formulário inline
- [ ] Implementar endpoints REST: POST/PUT/DELETE em `/api/spaces/admin/spaces`
- [ ] Validação: nome único, não desativar se tiver itens
- [ ] No card de espaços do dashboard, ADMIN pode editar o nome via botão flutuante `✏️` ao passar o mouse, deve aparece no canto supeior esquerdo
- [ ] Atualizar modal de realocação para listar espaços `isActive=true` e espaços finalizados para permitir retorno de itens
- [ ] A contagem exibida no card do dashboard deve usar a mesma regra de visibilidade dos itens mostrados dentro da sala
- [ ] O botão `📝 Novo espaço` deve ficar fora do card, logo após o componente de busca

### Substituir Alerts por Componentes Customizados

- [ ] Criar `ConfirmModal.jsx` e `ToastContainer.jsx`
- [ ] Criar contexto `ToastContext` para gerenciamento global
- [ ] Refatorar `room/[spaceId]/page.js`:
  - [ ] `window.confirm()` → `<ConfirmModal variant="danger" />`
  - [ ] `window.alert()` → `showToast({ type: 'error' })`
- [ ] Refatorar `dashboard/page.js` e outras páginas similares

### Notificação em Tempo Real

- [ ] Configurar `socket.io` no backend (servidor + eventos)
- [ ] Implementar listener no frontend ao entrar em uma sala
- [ ] Disparar evento `item-moved` ao realocar item
- [ ] Exibir toast automático ao receber evento
- [ ] Fallback para polling se WebSocket falhar

## 📊 Fase 10: Painel de Auditoria

- [ ] Criar página `/admin/unfound-items` com:
  - [ ] Tabela com filtros (período, espaço, conferente, ação)
  - [ ] Colunas conforme especificação
  - [ ] Botão "Ver Histórico" (abre modal com timeline)
  - [ ] Botão "Marcar como Encontrado" (reverte status)
- [ ] Implementar endpoint `GET /api/admin/unfound-items` com paginação
- [ ] Criar endpoint `GET /api/items/:id/historico` para timeline
- [ ] Adicionar exportação de auditoria: `GET /api/export/audit-xlsx`
