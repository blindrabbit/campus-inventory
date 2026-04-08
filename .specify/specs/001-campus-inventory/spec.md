# Specification: Sistema de Conferência de Patrimônio - Campus Aracruz

## 🎯 Visão Geral
Aplicação web colaborativa para mapeamento físico de inventário patrimonial, substituindo planilhas manuais por fluxo guiado de conferência por espaço, com auto-save, sincronização offline e exportação 100% compatível com `inventario.xlsx`.

## 👤 Perfis de Usuário
- **Administrador**: Gerencia espaços, reabre salas finalizadas, exporta relatórios, valida logs.
- **Conferente**: Executa conferência em campo, confirma/realoca itens, atualiza estado de conservação.
- **Visualizador**: Consulta status, acompanha progresso, exporta relatórios (somente leitura).

## 🔐 Autenticação
- **LDAP/AD Windows**: Autenticação via `sAMAccountName` contra Active Directory institucional.
- **Sessão**: JWT emitido após bind LDAP bem-sucedido, com `role` injetado via payload.
- **Provisionamento**: Primeiro login bem-sucedido cria registro `User` automaticamente com role padrão `CONFERENTE`.

## 🔄 Fluxo de Conferência
1. **Seleção de Espaço**: Lista de espaços ativos. Espaços finalizados ficam ocultos.
2. **Tela de Conferência**: Cabeçalho fixo (Nome, Responsável, Total Itens, Progresso %). Input manual para Nº patrimônio não listado. Lista de cards.
3. **Interação no Card**:
   - **Colapsado**: Nº Patrimônio | Nome | `[✅ CHECK]` | `[🗑️ REMOVER]`
   - **Expandido**: Dados completos, 3 botões visuais: `[🟢 Ótimo]` `[🟡 Regular]` `[🔴 Ruim]`
   - **CHECK**: Marca `Encontrado=sim`, salva `data_conferencia` e `conferente`.
   - **REMOVER**: Modal com `Realocar` ou `Não Localizado`.
4. **Realocação Visual**: Item aparece no destino com destaque (ex: fundo amarelo) e badge `⚠️ Movido de [Espaço X] por [Usuário]`. Requer confirmação no destino para consolidar vínculo.
5. **Validação Patrimônio Não Listado**: Rejeição imediata com toast: `"Patrimônio não consta no registro oficial."`
6. **Auto-Save & Offline**: Debounce de 1s. Offline fila ações em `IndexedDB` e sincroniza ao reconectar. Indicador `[💾 Salvo]` em <500ms.
7. **Finalização**: Botão `[🏁 Sala Finalizada]` bloqueia edições e move espaço para fila de revisão.

## 🔄 Fluxo de Remoção e Realocação (Sem Aprovação)

### Princípios
- **Sem aprovação necessária**: Conferentes podem realocar itens diretamente
- **Registro automático de histórico**: Sistema mantém lastro completo de movimentações
- **Notificação em tempo real**: Usuários com a sala destino aberta recebem toast informativo
- **Status "Não Localizado"**: Itens removidos sem realocação ficam com status PENDENTE/EXTRAVIADO

### Fluxo de Realocação
1. Conferente clica em "🗑️ Remover" no item
2. Modal abre com 2 opções:
   - **Realocar**: Seleciona sala destino da lista pré-cadastrada
   - **Não Localizado**: Justificativa opcional → Item marcado como "NAO_ENCONTRADO"
3. Ao confirmar realocação:
   - Item é **imediatamente** vinculado à nova sala
   - Registro em `ItemHistorico` com:
     - `fromSpaceId` (sala origem)
     - `toSpaceId` (sala destino)
     - `movedBy` (samAccountName do conferente)
     - `movedAt` (timestamp)
     - `action: "REALOCADO"`
   - Toast notifica usuários na sala destino (via WebSocket/Polling):
     *"Item #6446 que estava em LAB E06 foi movido para este ambiente por Hugo Martins"*
   - Item aparece destacado (bg-yellow-50) na nova sala até ser conferido

### Fluxo de "Não Localizado"
1. Conferente seleciona "Não Localizado"
2. Preenche justificativa (opcional)
3. Item recebe:
   - `statusEncontrado: "NAO"`
   - `lastKnownSpaceId` (mantém referência da última sala conhecida)
   - Registro em `ItemHistorico` com `action: "NAO_LOCALIZADO"`
4. Item sai da lista ativa da sala, mas permanece no banco para auditoria

### Histórico e Auditoria
- **Tabela `ItemHistorico`**: Registra TODAS as movimentações
  - Quem moveu
  - Quando moveu
  - De onde veio
  - Para onde foi
  - Tipo de ação (REALOCADO, NAO_LOCALIZADO, ESTORNADO)
- **Painel de Auditoria** (ADMIN/REVISOR):
  - Lista todos os itens "NAO_LOCALIZADO"
  - Mostra último local conhecido
  - Permite buscar por período, usuário, espaço
  - Exportação para Excel com colunas de auditoria

## 🔍 Funcionalidades de Busca e Navegação

### Busca de Setores no Cabeçalho
- **Campo de busca fixo** no header do dashboard
- **Busca em tempo real** (debounce 300ms) por:
  - Nome do espaço (ex: "LABORATÓRIO C07")
  - Responsável (ex: "JADIELSON")
  - Setor/unidade (ex: "COORDENADORIA DE TECNOLOGIA")
- **Resultados dropdown**:
  - Mostra nome do espaço + quantidade de itens
  - Clique navega diretamente para `/room/[spaceId]`
- **Atalho de teclado**: `Ctrl+K` ou `Cmd+K` foca na busca

### Lista de Espaços Pré-Cadastrados (Para Realocação)
- **CRUD de Espaços** (somente ADMIN):
  - Criar novos espaços antes da conferência
  - Editar nome/responsável
  - Desativar espaços (só se não tiver itens vinculados)
- **Espaços disponíveis para realocação**:
  - Todos os espaços `isActive=true` aparecem no modal de realocação
  - Inclusos espaços finalizados (para permitir retorno de itens)
  - Ordenados alfabeticamente por nome

## 📊 Painel de Auditoria (ADMIN/REVISOR)

### Listagem de Itens Não Localizados
- **Rota**: `/admin/unfound-items`
- **Filtros**:
  - Período (data da última conferência)
  - Espaço de origem
  - Usuário que conferiu
  - Tipo de ação (NAO_LOCALIZADO, REALOCADO)
- **Colunas**:
  - Nº Patrimônio
  - Descrição
  - Último Local Conhecido
  - Data da Última Conferência
  - Conferente
  - Status Atual
  - Ações: [Ver Histórico] [Marcar como Encontrado]
- **Exportação**: Gera Excel com todas as colunas de auditoria

### Histórico Completo do Item
- **Modal/Drawer** ao clicar em "Ver Histórico"
- **Timeline** de movimentações:
  - Data/hora
  - Ação realizada
  - Usuário responsável
  - Local origem → destino
  - Justificativa (se houver)

## 📊 Compatibilidade com `inventario.xlsx`
- Importação/Exportação mantêm 100% das colunas originais.
- Mapeamento interno: `você digita a sala` → `espaco_id`, `Encontrado` → `status_conferencia`, `condicao` → preservado. Botões visuais mapeiam: `Ótimo→EXCELENTE`, `Regular→BOM`, `Ruim→INSERVÍVEL`.
- Novas colunas internas não impactam exportação.

## 🚫 Fora de Escopo (v1)
- Upload de planilhas (carga inicial via script)
- QR Code/Etiquetas
- Integração direta com SIA/Patrimônio.gov.br
- Controle de empréstimo/saída temporária

## 🎨 Padrões de UI/UX

### Componentes de Feedback
- ❌ **NÃO USAR**: `window.alert()`, `window.confirm()`, `window.prompt()`
- ✅ **USAR**: Componentes modais customizados com:
  - Overlay escuro semi-transparente
  - Animação de fade-in/fade-out
  - Botões de ação claramente diferenciados (primária/secundária)
  - Suporte a tecla ESC para fechar
  - Focus trap (acessibilidade)

### Modal de Confirmação
- Título descritivo
- Mensagem clara da ação
- Botão "Cancelar" (secundário, à esquerda)
- Botão "Confirmar" (primário/vermelho se for ação destrutiva, à direita)
- Exemplos de uso:
  - Confirmar remoção de item
  - Confirmar finalização de sala
  - Confirmar realocação

### Modal de Notificação (Toast)
- Para mensagens de sucesso/erro/info
- Auto-dismiss após 3-5 segundos
- Posicionado no canto superior direito
- Múltiplos toasts empilháveis