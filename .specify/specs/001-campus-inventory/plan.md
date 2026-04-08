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

````prisma
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

````

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
