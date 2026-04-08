# Decision Records (ADRs)

## ADR-001: Substituir Alerts Nativos por Modais Customizados

**Data**: 2026-01-20  
**Status**: APROVADO  
**Impacto**: UX, Acessibilidade, Código

### Contexto

O sistema atualmente usa `window.alert()` e `window.confirm()` para:

- Confirmar remoção de itens
- Confirmar finalização de salas
- Mostrar mensagens de erro/sucesso

### Problema

- Alerts nativos bloqueiam a thread principal
- Não são customizáveis visualmente
- Experiência ruim em mobile
- Não seguem guidelines de acessibilidade WCAG
- Quebram o fluxo de usuário

### Decisão

Implementar sistema de modais customizados com:

- Componente `Modal` genérico
- Componente `ConfirmModal` especializado
- Sistema de Toast para notificações
- Animações suaves (fade-in/out)
- Suporte a teclado (ESC para fechar)
- Focus trap para acessibilidade

### Consequências

✅ **Positivas:**

- Melhor UX/UI
- Acessibilidade WCAG AA
- Customização total
- Não bloqueia thread

⚠️ **Negativas:**

- Mais código para manter
- Necessidade de testes adicionais
- Curva de aprendizado para novos devs

### Alternativas Consideradas

1. Biblioteca pronta (React Modal, Radix UI) → Rejeitada: queremos controle total
2. Manter alerts nativos → Rejeitada: UX inaceitável

### Referências

- Spec: `.specify/specs/001-campus-inventory/spec.md#padrões-de-uiux`
- Plan: `.specify/specs/001-campus-inventory/plan.md#7-componentes-de-ui---modal-system`
