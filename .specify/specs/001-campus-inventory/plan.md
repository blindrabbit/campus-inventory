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

enum Role { ADMIN, CONFERENTE, VISUALIZADOR }
enum StatusConf { SIM, NAO, PENDENTE }
enum CondicaoVis { EXCELENTE, BOM, INSERVIVEL }

## 4. API Contracts (Express)
POST /api/auth/login → { sAMAccountName, password } → LDAP bind → JWT
GET /api/spaces/active → Lista espaços não finalizados
GET /api/items?spaceId=:id → Retorna itens com status e relocações pendentes
POST /api/items/check → { itemId, condicao } → Atualiza statusEncontrado=SIM, debounce 1s
POST /api/items/relocate → { itemId, targetSpaceId } → Cria registro Relocation com flag pendingConfirm
POST /api/items/unfound → { itemId } → statusEncontrado=NAO, remove da lista ativa
POST /api/spaces/:id/finalize → Bloqueia espaço, gera log de auditoria

## 5. Key Algorithms & Logic
Excel Fidelity: Parser xlsx lê/gera mantendo ordem exata das colunas. Mapeia você digita a sala para space.name.
Offline Sync: Filha requisições falhas em IndexedDB. Ao reconectar, processa FIFO com idempotência (verifica updatedAt para evitar race conditions).
Highlight Realocação: Items com Relocation.pendingConfirm=true retornam com meta: { isRelocated: true, fromSpaceName }. Frontend aplica classe CSS bg-yellow-100 border-l-4 border-yellow-500.

## 6. Deployment Strategy
docker-compose.yml sobe frontend (port 3000) e backend (port 8000).
SQLite montado em volume Docker: ./data:/app/data.
Seed inicial: Script node backend/scripts/seed-xlsx.js lê inventario.xlsx e popula DB.