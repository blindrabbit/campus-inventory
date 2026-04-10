# Specification: Sistema de Conferência de Patrimônio - Campus Aracruz

## 🎯 Visão Geral

Aplicação web colaborativa para mapeamento físico de inventário patrimonial, substituindo planilhas manuais por fluxo guiado de conferência por espaço, com auto-save, sincronização offline e exportação compatível com o formato institucional.

Além do ciclo inicial, o sistema deve suportar **N verificações de inventário** (múltiplas campanhas), permitindo:

- iniciar um novo ciclo a partir de um ciclo anterior já finalizado
- iniciar um novo ciclo a partir de upload de novo arquivo XLSX no formato esperado
- controlar usuários permitidos por ciclo, campus associado e estado operacional do ciclo

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
- **Sincronização de nome (one-time)**: no primeiro cadastro do usuário, o sistema deve resolver o objeto do AD e persistir no banco local o `CN`/`displayName` como `fullName`
- **Nome canônico**: o valor exibido como nome do usuário deve vir do AD, não do siape digitado; o siape permanece apenas como `sAMAccountName`
- **Busca atômica de identidade**: a resolução do usuário no AD deve priorizar filtro explícito por `sAMAccountName`, `employeeID`, `uid`, `cn` e `displayName`, evitando depender de um retorno genérico de busca
- **Fallback seguro**: se o AD não devolver `CN`/`displayName`, o sistema pode manter o nome local existente, mas nunca substituir o nome por um valor parcial derivado do login
- **Bind obrigatório**: a busca de nome exige bind técnico configurado (`LDAP_BIND_USER` e `LDAP_BIND_PASS`) e o container do backend precisa ser recriado quando esses valores mudarem
- **Fonte pós-cadastro**: após o usuário existir no banco local, listagens, busca e exibição de dados de usuário devem usar somente a base local (sem nova consulta ao AD)

### Guardrails de Não Regressão (Obrigatórios)

- Alterações em autenticação **não podem** quebrar o parse do payload JSON em `POST /api/auth/login`.
- Erros de dependência/runtime devem retornar `500` ou `503` com mensagem padronizada; **não** mascarar falhas internas como `400` de validação.
- O contrato de login deve permanecer estável: entrada `{ sAMAccountName, password }` e saída `{ token, user, activeInventory }` quando autenticado.
- Funcionalidades já validadas em produção local (login, listagem de inventários autorizados, dashboard e sala com `inventoryId`) devem manter compatibilidade retroativa.
- Mudanças de autorização por inventário devem ser incrementais: nunca remover permissões existentes sem ação explícita de um `ADMIN_CICLO`.
- Toda nova regra de autorização deve ser aplicada em middleware único/reutilizável, evitando divergência entre rotas.

## 🧭 Gestão de Ciclos de Inventário (N Verificações)

### Entidade de Ciclo

Cada verificação de inventário deve ser representada por um **ciclo** com metadados próprios:

- `nome`
- `campusId` ou identificador de campus
- `fonteDados`: `REUTILIZAR_CICLO` ou `UPLOAD_XLSX`
- `cicloBaseId` (obrigatório quando `fonteDados=REUTILIZAR_CICLO`)
- `arquivoOrigem` (obrigatório quando `fonteDados=UPLOAD_XLSX`)
- `statusOperacao` (ver tabela de estados)
- `createdBy`, `createdAt`, `startedAt`, `finishedAt`

### Estados Operacionais do Ciclo

| Estado           | Descrição                                    | Regras principais                                                                 |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| **Não iniciado** | Ciclo criado, ainda sem execução             | Permite configurar usuários, espaços e fonte de dados                             |
| **Em execução**  | Ciclo em andamento                           | Permite conferência, realocação e atualização de itens conforme perfil autorizado |
| **Pausado**      | Execução interrompida temporariamente        | Bloqueia ações de conferência, mantém consulta e administração                    |
| **Em Auditoria** | Coleta encerrada, ciclo em revisão/validação | Bloqueia novas conferências, permite ajustes de auditoria por perfis autorizados  |
| **Finalizado**   | Ciclo concluído e fechado                    | Torna o ciclo elegível para reutilização como base de novo ciclo                  |
| **Cancelado**    | Ciclo encerrado sem validade operacional     | Mantém histórico, não pode ser reaberto para conferência                          |

### Reutilização de Inventário Anterior

- Apenas ciclos em estado **Finalizado** podem ser usados como base.
- Ao criar um novo ciclo por reutilização, o sistema deve copiar os dados patrimoniais consolidados do ciclo base para o novo contexto.
- O novo ciclo deve manter trilha de origem (`cicloBaseId`) para auditoria.

### Novo Ciclo via Upload XLSX

- O upload deve validar cabeçalhos e estrutura antes da carga.
- Em caso de divergência de layout, o sistema deve bloquear a importação e exibir os campos esperados.
- A carga inicial do ciclo deve ser idempotente por `patrimonio + cicloId`.

### Gestão de Usuários Permitidos por Ciclo

- Cada ciclo deve possuir lista explícita de usuários autorizados.
- Perfis por ciclo: `ADMIN_CICLO`, `CONFERENTE`, `REVISOR`, `VISUALIZADOR`.
- Usuário sem vínculo ao ciclo não pode acessar telas operacionais desse ciclo.

### Gestão Global de Usuários (CRUD Geral)

- Deve existir uma área administrativa central para **gerenciamento global de usuários locais**.
- A listagem deve exibir todos os usuários cadastrados no banco local, com:
  - `CN` (nome completo)
  - `sAMAccountName` (siape/login)
  - papel global do usuário
- O `CN` exibido na listagem deve refletir o nome persistido localmente após sincronização de login LDAP.
- Cada card de usuário deve mostrar os inventários em que ele possui vínculo por meio de badges.
- Cada badge de inventário deve permitir remoção rápida do vínculo:
  - o ícone de remoção (`x`) aparece ao passar o mouse sobre a badge
  - a remoção exige confirmação explícita em modal
- Cada card deve conter ação `add` para incluir o usuário em um inventário:
  - selecionar inventário de destino
  - selecionar perfil no inventário (`ADMIN_CICLO`, `CONFERENTE`, `REVISOR`, `VISUALIZADOR`)
  - confirmar inclusão
- O CRUD geral deve operar somente sobre usuários já registrados no banco local.
- O cadastro local deve manter o `CN` persistido no primeiro provisionamento; atualizações posteriores exigem ação administrativa explícita.
- A recuperação do nome do usuário no painel administrativo não deve depender de recomposição a partir do siape; deve usar o valor já persistido após a sincronização LDAP.

### Painel Próprio de Inventários Autorizados

- Usuários comuns devem visualizar apenas os inventários para os quais possuem autorização explícita.
- A listagem deve ficar em painel próprio (ex.: "Meus Inventários").
- Inventários não autorizados não devem aparecer na listagem nem ser acessíveis por URL direta.

### Layout da Tela Pós-Login (Meus Inventários)

- A tela de listagem de inventários deve reutilizar o mesmo cabeçalho visual do dashboard, contendo:
  - `Campus Inventory`
  - `Sistema de Conferência de Patrimônio`
  - ação `[Sair]` no canto direito
- O acesso ao inventário deve ocorrer pelo clique no card completo (área inteira clicável), e não por botão interno de "acessar".
- Deve existir ação explícita `Criar novo inventário` visível para perfil com permissão de criação (ADMIN global e/ou ADMIN_CICLO conforme política).

### Criação e Gestão de Inventário

- O botão `Criar novo inventário` deve abrir a tela de gestão/criação de inventário.
- A tela de gestão deve permitir informar, no mínimo:
  - nome do inventário
  - servidor responsável principal (dono do inventário)
  - fonte da carga inicial:
    - reutilizar inventário finalizado existente no banco, ou
    - upload de planilha XLSX no formato institucional
  - data de início
  - data de término
  - usuários adicionais com acesso ao inventário e seus perfis
- A tela deve validar obrigatoriedade e consistência dos campos (ex.: fim não pode ser anterior ao início).

### Importação de Portaria da Comissão (PDF)

- A tela de criação de inventário deve permitir upload de PDF da portaria de comissão para gerar prévia de preenchimento.
- A identificação de membros na portaria deve extrair `nome + matrícula SIAPE` por linha de texto.
- A resolução no Active Directory deve priorizar o SIAPE entre parênteses e aceitar apenas correspondência única.
- A busca de SIAPE no AD deve considerar identificadores exatos equivalentes (`employeeID`, `sAMAccountName`, `uid`) mantendo validação de unicidade.
- O responsável do inventário deve seguir a regra:
  - usar a indicação explícita da portaria (ex.: presidente/responsável/coordenador), quando existir
  - se não houver declaração clara, usar o primeiro nome válido extraído como responsável
- A importação deve ser em duas etapas: `prévia` e `confirmação explícita`.
- Ao confirmar a importação, a prévia deve ser fechada e os dados devem ser aplicados no formulário (`responsável` e `membros`).
- Se não houver dados válidos para aplicar, o sistema deve informar claramente e não sinalizar sucesso enganoso.

### Aba de Permissões no Inventário (Admin do Inventário)

- Em cada inventário, usuários com perfil `ADMIN_CICLO` devem visualizar abas administrativas adicionais, incluindo **Permissões**.
- A aba de permissões deve permitir:
  - buscar usuário por `siape`, `cpf` ou `nome`
  - validar primeiro no banco local de usuários
  - se não existir no banco, consultar Active Directory apenas para inclusão inicial
  - ao confirmar inclusão, persistir o usuário no banco local e conceder permissão no inventário
  - remover usuário do inventário
  - ajustar nível de acesso para somente visualização (`VISUALIZADOR`), sem permitir alterações

### Administração de Situação do Inventário

- Na área administrativa do inventário (aba de permissões ou aba de configurações), o `ADMIN_CICLO` deve conseguir:
  - alterar nome do inventário
  - alterar estado operacional do inventário conforme regras de transição
  - registrar histórico de alteração (quem alterou, quando, de qual estado para qual estado)

### Estrutura de Telas para Ciclos

- **Tela Meus Inventários**: exibe somente inventários autorizados ao usuário logado.
- **Tela de Inventários**: lista de ciclos com filtros por campus, status e período.
- **Tela de Criação de Ciclo**: wizard com identificação, campus, fonte de dados e usuários permitidos.
- **Tela de Gestão do Ciclo**: painel com progresso, ações de mudança de estado e configuração.
- **Tela de Usuários do Ciclo**: adicionar/remover participantes e ajustar perfis.
- **Tela de Gestão Global de Usuários**: listar usuários locais e gerenciar vínculos por inventário no card do usuário.
- **Tela de Auditoria do Ciclo**: revisão de não localizados, histórico e fechamento.

#### Comportamentos obrigatórios da Tela Meus Inventários

- ADMIN visualiza todos os inventários.
- Usuário comum visualiza apenas inventários autorizados.
- Card inteiro é clicável para seleção do inventário ativo.
- Deve haver CTA para criação de novo inventário.

## 🔄 Fluxo de Conferência

> Todas as operações abaixo devem sempre considerar o **ciclo ativo selecionado**.

### 1. Seleção de Espaço

- Lista de espaços `isActive=true`, incluindo espaços finalizados com badge de status
- **Busca no header**: Campo com debounce 300ms para filtrar por nome do espaço
- Atalho `Ctrl+K` foca na busca
- Clique no card navega para `/room/[spaceId]`
- Card de espaço deve exibir badge de execução da conferência:
  - `🔴 Não iniciado`
  - `🟠 Iniciado em DD/MM/AA por <Nome do usuário>`
  - `🟢 Finalizado`
- Quando o usuário for **ADMINISTRADOR**, cada card de espaço exibe apenas uma ação de edição flutuante:
  - `✏️` no canto superior direito do card ao passar o mouse sobre a sala
- A ação `📝 Novo espaço` fica fora do card, logo após o componente de busca do header

### 1.1 Organização do Dashboard por Abas/Seções do Inventário

- A região inferior do dashboard (informações do inventário e conteúdo operacional) deve concentrar ações administrativas em formato de abas ou botões de seção.
- O acesso de auditoria deve ser movido para essa região (não como botão solto no topo), preferencialmente em aba `Auditoria`.
- Além de `Auditoria`, deve existir:
  - aba/seção `Permissões` (gestão de servidores com acesso)
  - aba/seção `Dados` (nome do inventário, responsável, início, fim, status e metadados)
- A visibilidade das abas administrativas deve respeitar o perfil do usuário no inventário.
- A caixa de acesso às abas, posicionada ao final da lista de espaços, deve ser unificada com a própria caixa de conteúdo das abas.
- A navegação das abas e o conteúdo da aba ativa devem existir no mesmo container visual (header de abas + painel), evitando caixas separadas para acesso e exibição.
- O container de abas deve priorizar flexibilidade de acesso:
  - desktop: navegação horizontal por abas com troca imediata de conteúdo
  - mobile: navegação adaptável (scroll horizontal ou seletor) sem perder acesso às ações administrativas
  - manter contexto da lista de espaços sem exigir rolagem excessiva entre o seletor e o conteúdo da aba ativa

### 2. Tela de Conferência

┌─────────────────────────────────────────────────┐
│ [🔍 Buscar espaços...] [👤 User] [Sair] │ ← Header fixo
├─────────────────────────────────────────────────┤
│ 🏢 LABORATÓRIO E06 │
│ Responsável: JADIELSON • 45 itens visíveis • 67% conferido│
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
[↩️ DESFAZER] - Reverte ações elegíveis (realocação pendente e confirmação de encontrado)
[➡️ MOVER] - Abre modal de realocação:

- Campo de pesquisa acima de `Selecione um espaço...` para filtrar por nome do espaço e responsável
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
| **↩️ DESFAZER (Encontrado)** | Remove a confirmação de encontrado e volta para pendente | `statusEncontrado=PENDENTE`, limpa dados de conferência, `ItemHistorico` com ação `DESFEITO_ENCONTRADO` |
| **↩️ DESFAZER (Movimentação)** | Estorna a realocação pendente para a sala de origem | Atualiza `spaceId` para origem, `ItemHistorico` com ação `ESTORNADO` contendo `fromSpaceId` e `toSpaceId` |

### 4.1 Histórico de Atualizações da Sala

- A aba da sala deve ser tratada como **Histórico de atualizações** (não apenas movimentações).
- O histórico deve listar, no mínimo, as ações: `ENCONTRADO`, `NAO_LOCALIZADO`, `REALOCADO`, `ESTORNADO`, `DESFEITO_ENCONTRADO`.
- Cada linha deve exibir: patrimônio, descrição, ação padronizada, direção, origem/destino, responsável e data/hora.
- A marcação de encontrado, não localizado e ações de desfazer devem aparecer imediatamente no histórico da sala (atualização otimista), preservando consistência após sincronização.

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

### 6.1. Encontrado em Massa por Intervalo de Patrimônio

- A tela da sala deve oferecer ação de lote para marcar itens como encontrados por intervalo de patrimônio.
- Fluxo obrigatório:
  - informar `patrimonioInicial` e `patrimonioFinal`
  - gerar prévia com total de itens que serão atualizados
  - confirmar explicitamente antes de aplicar a alteração em massa
- Regras de negócio:
  - intervalo inclusivo (`inicial` e `final` fazem parte do lote)
  - cada item atualizado deve gerar trilha de auditoria (`ENCONTRADO`)
  - patrimônios fora do intervalo ou inválidos entram no resumo de ignorados, sem falhar toda operação

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

### 9. Consistência de Quantitativo

- O quantitativo exibido no card do dashboard deve refletir a mesma regra de listagem usada dentro da sala.
- Se um item não aparece na lista da sala, ele não deve ser contado como item visível no card.
- Qualquer ajuste de filtro na sala deve ser espelhado na origem da contagem do dashboard.

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

No card de espaços (dashboard):
✅ ADMIN pode alterar o nome do espaço existente via botão flutuante `✏️`
✅ ADMIN pode criar novo espaço via botão `📝` fora do card, logo após a busca

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
100% das colunas esperadas preservadas nos campos do model Item

Formato esperado pelo importador da carga inicial (ordem de cabeçalhos):

unidade
setor
responsavel
codigo
descricao
valor
condicao
fornecedor
cnpj_fornecedor
catalogo
codigo_sia
descricao_sia
patrimonio
numero_entrada
data_entrada
data_aquisicao
documento
data_documento
tipo_aquisicao

Regras de compatibilidade:

- Esses cabeçalhos são obrigatórios para upload de nova carga.
- Colunas acessórias não listadas acima não devem ser exigidas pelo importador.
- O sistema deve permitir mapear sala/espaço por regra de negócio do ciclo (ex.: campo adicional configurado no wizard).

Exportação (Relatórios)
Exportação padrão (/api/export/xlsx):
Gera arquivo compatível com a estrutura oficial esperada
Inclui itens do ciclo selecionado conforme regras de status e auditoria
Exportação de auditoria (/api/export/audit-xlsx):
Inclui colunas adicionais para rastreabilidade
Disponível apenas para perfis ADMIN ou REVISOR

Observação:

- Colunas históricas de planilhas antigas (por exemplo colunas acessórias de conferência manual) não são parte do contrato obrigatório do importador.

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

Geração automática de QR Code/Etiquetas
Integração direta com SIA/Patrimônio.gov.br
Controle de empréstimo/saída temporária de itens
Aplicativo mobile nativo (PWA responsivo cobre o caso de uso)
Relatórios de Business Intelligence avançados

## 📋 Critérios de Aceite do MVP

Login LDAP funciona com usuário real da instituição
É possível criar múltiplos ciclos de inventário (N verificações)
Novo ciclo permite escolher entre reutilizar ciclo finalizado ou upload XLSX
Upload XLSX valida obrigatoriamente os 19 cabeçalhos esperados
Cada ciclo possui campus e lista de usuários permitidos
Usuário comum visualiza apenas inventários autorizados em painel próprio
Tela de inventários reutiliza cabeçalho padrão do dashboard (`Campus Inventory`, subtítulo institucional e ação `Sair`)
Seleção de inventário ocorre por clique no card inteiro
Existe ação de `Criar novo inventário` levando à tela de gestão
Tela de gestão de inventário permite definir nome, dono, fonte inicial, datas e usuários com acesso
Usuário sem permissão não acessa inventário por URL direta
ADMIN_CICLO consegue adicionar/remover usuários no inventário
Busca de usuários em permissões aceita siape/cpf/nome e usa base local como fonte principal
Consulta ao AD ocorre apenas no primeiro cadastro do usuário (quando ainda não existir localmente)
Perfil VISUALIZADOR consegue acessar sem editar dados dos ambientes
ADMIN_CICLO consegue alterar nome e status operacional do inventário
Estados do ciclo funcionam: Não iniciado, Pausado, Em Auditoria, Finalizado, Cancelado
Dashboard organiza ações de inventário em abas/seções incluindo `Auditoria`, `Permissões` e `Dados`
Busca de espaços no header filtra em tempo real (debounce 300ms)
Card de item expande/colapsa com clique no corpo
Botões de conservação atualizam condicaoVisual com auto-save
Realocação move item imediatamente e notifica via toast
Itens "Não Localizados" aparecem no painel de auditoria com lastro
Exportação gera arquivo compatível com o formato oficial esperado
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
