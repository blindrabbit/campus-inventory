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

## 📊 Compatibilidade com `inventario.xlsx`
- Importação/Exportação mantêm 100% das colunas originais.
- Mapeamento interno: `você digita a sala` → `espaco_id`, `Encontrado` → `status_conferencia`, `condicao` → preservado. Botões visuais mapeiam: `Ótimo→EXCELENTE`, `Regular→BOM`, `Ruim→INSERVÍVEL`.
- Novas colunas internas não impactam exportação.

## 🚫 Fora de Escopo (v1)
- Upload de planilhas (carga inicial via script)
- QR Code/Etiquetas
- Integração direta com SIA/Patrimônio.gov.br
- Controle de empréstimo/saída temporária