# Constitution: Campus Inventory Mapping System

## 🎯 Propósito
Sistema web colaborativo para mapeamento, consulta e gestão de inventário físico do campus, permitindo que múltiplos usuários cadastrem, localizem e auditem itens em tempo real.

## 🔐 Princípios de Segurança
- Autenticação obrigatória para todas as operações de escrita
- Dados pessoais protegidos conforme LGPD
- Logs de auditoria imutáveis para todas as alterações

## 👥 Princípios de Colaboração
- Múltiplos usuários podem editar simultaneamente com controle de concorrência
- Permissões granulares por tipo de usuário e por área do campus
- Notificações em tempo real sobre alterações relevantes

## ⚡ Princípios de Experiência
- Interface intuitiva para coleta em campo via mobile
- Mapa interativo com carregamento progressivo para performance
- Funcionalidade offline-first para áreas sem conectividade

## 🛠️ Princípios Técnicos
- API-first para permitir integrações futuras
- Stack moderna mas com baixa complexidade operacional
- Documentação automática de todos os contratos de API

## 🔄 Princípio de Fidelidade de Dados (Data Fidelity)
- **Compatibilidade Estrita**: O sistema deve importar e exportar dados mantendo 100% da estrutura de colunas do arquivo base (`inventario.xlsx`).
- **Não Perda de Informação**: Nenhuma informação administrativa (Código SIA, Patrimônio, CNPJ, Valores, Datas) pode ser perdida ou alterada indevidamente.
- **Enriquecimento Progressivo**: O sistema adicionará dados operacionais (Geolocalização/Mapa, Foto, Status de Conferência) sem quebrar o formato original de exportação.
- **Exportação "Pronta para Uso"**: O arquivo exportado deve estar pronto para ser reenviado à administração central sem necessidade de ajustes manuais em planilhas.

## 🚫 Fora de Escopo (v1)
- Integração com sistemas legados de patrimônio
- Aplicativo mobile nativo (foco em PWA responsivo)
- Controle de saída/empréstimo de itens (apenas localização e status)

