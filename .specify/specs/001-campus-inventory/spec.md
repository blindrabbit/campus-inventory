# Specification: Sistema de Conferência de Patrimônio - Campus Aracruz

## 🎯 Visão Geral

Aplicação web colaborativa para mapeamento físico de inventário patrimonial do Campus Aracruz, substituindo planilhas manuais por fluxo guiado de conferência por espaço, com auto-save, sincronização offline e exportação 100% compatível com `inventario.xlsx`.

## 👤 Perfis de Usuário

| Perfil            | Permissões                                                             | Responsabilidades                                              |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Administrador** | CRUD de espaços, reabrir salas, exportar relatórios, acessar auditoria | Gerenciar estrutura do campus, validar logs, promover usuários |
| **Conferente**    | Conferir itens, realocar, atualizar conservação                        | Executar conferência em campo, registrar status dos itens      |
| **Visualizador**  | Consulta e exportação básica                                           | Acompanhar progresso, gerar relatórios (somente leitura)       |

## 🔐 Autenticação

- **LDAP/AD Windows**: Autenticação via `sAMAccountName` contra Active Directory institucional
- **Sessão**: JWT emitido após bind LDAP bem-sucedido, com `{ sub, role, fullName }` no payload
- **Provisionamento**: Primeiro login cria registro `User` automaticamente com role `CONFERENTE`
- **Promoção para ADMIN**: Via script `promote-admin.js` (só após primeiro login)

## 🔄 Fluxo de Conferência

### 1. Seleção de Espaço

- Lista de espaços `isActive=true AND isFinalized=false`
- **Busca no header**: Campo com debounce 300ms para filtrar por nome, responsável ou setor
- Atalho `Ctrl+K` foca na busca
- Clique no card navega para `/room/[spaceId]`

### 2. Tela de Conferência

┌─────────────────────────────────────────────────┐
│ [🔍 Buscar espaços...] [👤 User] [Sair] │ ← Header fixo
├─────────────────────────────────────────────────┤
│ 🏢 LABORATÓRIO E06 │
│ Responsável: JADIELSON • 45 itens • 67% conferido│
│ [████████████░░░░░░░░░░░░░░░░░░] Progress Bar │
├─────────────────────────────────────────────────┤
│ [➕ Patrimônio não listado: ______] [Buscar] │ ← Input manual
├─────────────────────────────────────────────────┤
│ 📦 Lista de Cards (itens do espaço) │
└─────────────────────────────────────────────────┘

### 3. Interação no Card de Item

**Estado Colapsado:**
#15170 | SUPORTE PRETO PROJETOR... | [✅ Encontrado] [➡️ MOVER] [🚫 NÃO LOCALIZADO]

**📋 Informações Completas:**
• Descrição: SUPORTE PRETO PROJETOR TETO/PAREDE
• Valor: R$ 150,00 | Condição Original: EXCELENTE
• Código SIA: 123110405 | Fornecedor: LMR SOLUTIONS LTDA
• Data Aquisição: 2024-08-27 | Documento: NF
🎨 Estado de Conservação:
[🟢 Ótimo] [🟡 Regular] [🔴 Ruim] ← Botões visuais
⚙️ Ações:
[ ↩️ DESFAZER]

**_Ações dos Botões_**
[✅ Encontrado] - Sinaiza o item como encontrado (verde) e salva statusEncontrado=SIM
[➡️ MOVER] - Abre modal de realocação para escolher novo espaço
[🚫 NÃO LOCALIZADO] - Sinaliza item como não encontrado (vermelho)
[↩️ DESFAZER] - Reverte última ação, volta ao estado anterior
[➡️ MOVER] - Abre modal de realocação:

- Dropdown com espaços ativos (exclui current space)
  [🟢 Ótimo] - ALtera o estado de conservação do item para otimo
  [🟡 Regular] - Altera o estado de conservação do item para regular
  [🔴 Ruim] - Altera o estado de conservação do item para Ruim

### 4. Ações do Card

| Ação                  | Comportamento                               | Dados Salvos                                                                          |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| **✅ Encontrado**     | Marca como encontrado na sala atual         | `statusEncontrado=SIM`, `condicaoVisual`, `dataConferencia`, `ultimoConferente`       |
| **➡️ MOVER**          | Move item para outra sala pré-cadastrada    | Cria `ItemHistorico`, atualiza `spaceId`, notifica sala destino via toast             |
| **🚫 NÃO LOCALIZADO** | Item sai da lista ativa, entra em auditoria | `statusEncontrado=NAO`, `lastKnownSpaceId`, `ItemHistorico` com ação `NAO_LOCALIZADO` |

### 5. Realocação em Tempo Real

- Ao realocar, item aparece **imediatamente** na sala destino
- Destaque visual: `bg-yellow-50 border-l-4 border-yellow-500`
- Badge informativo: `⚠️ Movido de [LAB E06] por [Hugo Martins]`
- **Toast automático** para usuários com a sala destino aberta:
  > _"Item #15170 que estava em LAB E06 foi movido para este ambiente por Hugo Martins"_
- Item requer confirmação (`CHECK`) na nova sala para consolidar vínculo

### 6. Validação de Patrimônio Não Listado

- Input manual aceita apenas números de patrimônio existentes no banco
- Se não encontrar: toast de erro `"Patrimônio não consta no registro oficial."`
- **Não cria** registros temporários ou pendentes

### 7. Auto-Save & Offline

- Cada interação dispara requisição com `debounce(1000ms)`
- Indicador visual `[💾 Salvo]` aparece em <500ms
- **Modo offline**: Ações são enfileiradas no `IndexedDB` e sincronizadas automaticamente ao reconectar
- Idempotência: Verifica `updatedAt` para evitar race conditions

### 8. Finalização de Sala

- Botão `[🏁 Sala Finalizada]` no rodapé
- Confirmação via modal customizado (não `window.confirm`)
- Efeitos:
  - `isFinalized=true` no espaço
  - Remove da lista ativa de conferência
  - Move para fila de revisão (acessível por ADMIN)
  - Bloqueia edições até reabertura

## 🔄 Fluxo de Remoção e Realocação (Sem Aprovação)

### Princípios

- ✅ Conferentes podem realocar itens **sem aprovação prévia**
- ✅ Histórico automático: toda movimentação gera registro em `ItemHistorico`
- ✅ Notificação em tempo real via WebSocket/Polling para salas afetadas
- ✅ Auditoria completa: lastro de "onde estava → para onde foi → quem fez"

### Registro de Histórico (`ItemHistorico`)

Cada ação de movimentação cria um registro com:

```typescript
{
  itemId: string,
  fromSpaceId: string | null,    // null se for criação
  toSpaceId: string | null,      // null se for remoção definitiva
  action: 'CRIADO' | 'REALOCADO' | 'NAO_LOCALIZADO' | 'ENCONTRADO' | 'ESTORNADO',
  reason: string | null,         // justificativa opcional
  createdBy: string,             // samAccountName do usuário
  createdAt: DateTime,
  metadata?: Json                // dados adicionais (ex: toast message)
}

```

**Status dos Itens**

```typescript
enum StatusConf {
  SIM           // Item confirmado na sala atual
  NAO           // Não localizado (aguardando auditoria)
  PENDENTE      // Em processo de realocação/confirmação
}
```

## 🔍 Funcionalidades de Busca e Navegação

**Busca de Espaços no Header**

Componente: SpaceSearchBar fixo no header do dashboard e da sala
Busca em tempo real (debounce 300ms) por:
space.name (ex: "LABORATÓRIO C07")
space.responsible (ex: "JADIELSON")
space.sector (ex: "COORDENADORIA DE TECNOLOGIA")

Dropdown de resultados (máx 10):
Exibe: Nome do Espaço • X itens • Responsável
Clique navega para /room/[spaceId]

Acessibilidade:
Atalho Ctrl+K / Cmd+K foca no input
Navegação por setas ↑↓ e Enter para selecionar
ESC fecha o dropdown

**CRUD de Espaços (ADMIN apenas)**
Rota: /admin/spaces

Operações:
✅ Criar novo espaço (nome, responsável, setor, unidade)
✅ Editar nome/responsável de espaço existente
✅ Desativar espaço (isActive=false) — só se count(items) === 0

Validações:
Nome único (case-insensitive)
Não permitir exclusão física (soft-delete apenas)
Impacto na realocação:
Espaços isActive=true aparecem no modal de realocação
Espaços finalizados também aparecem (para permitir retorno de itens)
Ordenação alfabética por nome

## 📊 Painel de Auditoria (ADMIN/REVISOR)

Listagem de Itens Não Localizados
Rota: /admin/unfound-items
Filtros avançados:
Período: dataConferencia entre X e Y
Espaço de origem: dropdown com todos os espaços
Conferente: busca por samAccountName ou nome
Ação: NAO_LOCALIZADO, REALOCADO, ESTORNADO
Colunas da tabela:
Coluna Descrição
Nº Patrimônio Link para detalhes do item
Descrição Texto resumido (tooltip com completo)
Último Local Conhecido Nome do espaço + link
Data da Última Conferência Formatada DD/MM/YYYY HH:mm
Conferente Nome + samAccountName Status Atual Badge colorido (NAO/REALOCADO/etc)
Ações [📋 Histórico] [✅ Marcar como Encontrado]

Exportação: Botão gera inventario_auditoria_YYYYMMDD.xlsx com:
Todas as colunas originais do inventario.xlsx
Colunas adicionais de auditoria: status_atual, data_ultima_alteracao, ultimo_responsavel, historico_localizacoes

**Histórico Completo do Item**
Acesso: Modal/Drawer ao clicar em "📋 Histórico" na tabela de auditoria ou no card expandido
Conteúdo: Timeline vertical com:
🕐 20/01/2026 14:30 — REALOCADO
De: LABORATÓRIO E06 → Para: SALA D03
Por: Hugo Martins (1918648)
Justificativa: "Item transferido para novo laboratório"

🕐 15/01/2026 09:15 — ENCONTRADO
Local: LABORATÓRIO E06
Por: Maria Silva (1234567)
Conservação: 🟢 Ótimo

🕐 10/01/2026 16:45 — CRIADO
Importado de inventario.xlsx
Local inicial: COORDENADORIA DE ALMOXARIFADO

## 📊 Compatibilidade com inventario.xlsx

Importação (Seed Inicial)
Script seed-xlsx.js lê o arquivo e popula o banco mantendo:
100% das colunas originais preservadas nos campos do model Item
Mapeamento direto: você digita a sala → Space.name → Item.spaceId
Valores de Encontrado (sim/não) → statusEncontrado (SIM/NAO)
Botões visuais de conservação mapeiam para: Ótimo→EXCELENTE, Regular→BOM, Ruim→INSERVÍVEL
Exportação (Relatórios)
Exportação padrão (/api/export/xlsx):
Gera arquivo idêntico ao original em estrutura de colunas
Inclui apenas itens com statusEncontrado IN (SIM, NAO) aprovados
Atualiza colunas de conferência: Encontrado, 1/20/26, Hugo Martins..., condicao
Exportação de auditoria (/api/export/audit-xlsx):
Inclui colunas adicionais para rastreabilidade
Disponível apenas para perfis ADMIN ou REVISOR
Colunas do inventario.xlsx (Referência)

unidade | setor | responsavel | codigo | descricao | valor | condicao |
fornecedor | cnpj_fornecedor | catalogo | codigo_sia | descricao_sia |
patrimonio | numero_entrada | data_entrada | data_aquisicao | documento |
data_documento | tipo_aquisicao | você digita a sala | (estado) |
Encontrado | 1/20/26 | Hugo Martins de Carvalho | não_listado

## 🎨 Padrões de UI/UX

Componentes de Feedback
❌ PROIBIDO: window.alert(), window.confirm(), window.prompt()
✅ OBRIGATÓRIO: Componentes customizados com:
Overlay escuro semi-transparente (bg-black/50)
Animação fade-in/fade-out (200ms)
Botões claramente diferenciados (primária: cor sólida, secundária: outline)
Suporte a tecla ESC para fechar
Focus trap para acessibilidade (WCAG 2.1 AA)

Modal de Confirmação (ConfirmModal)

```jsx
<ConfirmModal
  isOpen={boolean}
  onConfirm={function}
  onCancel={function}
  title="Confirmar ação"
  message="Deseja realmente remover este item do espaço?"
  confirmText="Confirmar"      // opcional, default: "Confirmar"
  cancelText="Cancelar"        // opcional, default: "Cancelar"
  variant="danger|warning|info" // opcional, default: "info"
/>
```

Layout: Título em negrito, mensagem em texto normal, botões alinhados à direita
Cores:
danger: Botão confirmar em vermelho (para ações destrutivas)
warning: Botão confirmar em amarelo (para ações de atenção)
info: Botão confirmar em azul (para ações informativas)
Sistema de Toast (ToastContainer)

```jsx
// Uso via hook:
const { showToast } = useToast();

showToast({
  type: "success" | "error" | "info" | "warning",
  title: "Título opcional",
  message: "Mensagem principal",
  duration: 3000, // opcional, default: 3000ms
});
```

Posicionamento: Canto superior direito, empilhável (máx 3 visíveis)
Auto-dismiss: 3-5 segundos (configurável)
Interação: Clique para fechar manualmente, hover pausa o timer
Acessibilidade: role="alert" para leitores de tela

**Estados Visuais de Itens**
Status
Estilo CSS
Badge
ENCONTRADO
border-l-4 border-green-500
✓ Conferido (verde)
REALOCADO (pendente)
border-l-4 border-yellow-500 bg-yellow-50
⚠️ Movido de [X] (amarelo)
NAO_LOCALIZADO
border-l-4 border-red-300 opacity-75
❌ Não encontrado (vermelho)
EXPANDIDO
shadow-lg ring-2 ring-blue-200
—

## 🚫 Fora de Escopo (v1)

Upload de planilhas via interface (carga inicial via script CLI)
Geração automática de QR Code/Etiquetas
Integração direta com SIA/Patrimônio.gov.br
Controle de empréstimo/saída temporária de itens
Aplicativo mobile nativo (PWA responsivo cobre o caso de uso)
Relatórios de Business Intelligence avançados

## 📋 Critérios de Aceite do MVP

Login LDAP funciona com usuário real da instituição
Busca de espaços no header filtra em tempo real (debounce 300ms)
Card de item expande/colapsa com clique no corpo
Botões de conservação atualizam condicaoVisual com auto-save
Realocação move item imediatamente e notifica via toast
Itens "Não Localizados" aparecem no painel de auditoria com lastro
Exportação gera arquivo compatível com inventario.xlsx original
Nenhum window.alert() ou window.confirm() é usado na interface
App funciona em mobile (PWA responsivo) e offline básico

---

## 🔧 Atualizações Complementares (Opcionais)

### Para `plan.md` (resumo das mudanças técnicas):

```markdown
## 7. Atualizações de Modelo de Dados

### Novo Model: ItemHistorico

- Tabela para auditoria completa de movimentações
- Índices em `[itemId, createdAt]`, `[fromSpaceId]`, `[toSpaceId]` para performance

### Atualizações em Item

- Adicionar `lastKnownSpaceId` (para rastreabilidade de itens não localizados)
- Adicionar índice em `[statusEncontrado, lastKnownSpaceId]`

### WebSocket para Notificações em Tempo Real

- Biblioteca: `socket.io` (backend) + `socket.io-client` (frontend)
- Evento: `item-moved` → payload com dados do item e mensagem do toast
- Fallback: Polling a cada 5s se WebSocket falhar

### Componentes de UI Novos

- `SpaceSearchBar`: Busca com debounce, dropdown, atalhos de teclado
- `ConfirmModal`: Modal padronizado para confirmações
- `ToastContainer`: Sistema de notificações empilháveis
```
