# Campus Inventory

Sistema web para conferência, auditoria e gestão de inventário patrimonial em ambiente de campus.

O projeto substitui controles manuais baseados em planilhas por um fluxo operacional guiado por salas, ciclos de inventário, perfis de acesso, logs de movimentação e acompanhamento em tempo real da execução.

## Visão geral

O Campus Inventory foi desenvolvido para apoiar campanhas de conferência patrimonial em que diferentes usuários precisam atuar simultaneamente sobre espaços físicos, itens patrimoniais e acervos bibliográficos.

O sistema permite:

- criar e gerenciar ciclos de inventário;
- controlar acesso por usuário e por inventário;
- conferir itens por sala;
- registrar itens encontrados, pendentes, não localizados e duplicados;
- movimentar patrimônios entre salas com histórico;
- importar dados patrimoniais e acervo bibliográfico via XLSX;
- acompanhar auditoria, eventos e relatórios operacionais;
- manter rastreabilidade das ações executadas pelos usuários.

## Principais funcionalidades

### Gestão de inventários

- Criação de ciclos de inventário independentes.
- Reutilização de inventários finalizados como base para novos ciclos.
- Controle de status operacional: não iniciado, em execução, pausado, em auditoria, finalizado e cancelado.
- Associação de usuários e perfis por inventário.

### Conferência por salas

- Listagem de espaços do campus.
- Busca de salas por nome.
- Abertura de sala para conferência dos itens esperados.
- Marcação de item encontrado ou não localizado.
- Registro de condição visual.
- Finalização, lacre e revisão de salas conforme perfil de acesso.

### Busca e leitura de itens

- Busca por patrimônio, descrição, código de barras, RFID e autores.
- Modal de leitura para uso com leitor de código de barras ou RFID.
- Mensagem clara quando um item não é encontrado, orientando nova tentativa ou busca manual.
- Suporte a livros sem número de patrimônio, identificados pelo código de barras do exemplar.

### Movimentações planejadas

- Tela própria para montar uma lista de movimentações antes da execução.
- Associação de patrimônio e sala de destino.
- Inclusão e remoção de movimentações antes da confirmação.
- Execução em lote.
- Suporte a movimentações envolvendo salas lacradas.
- Geração de logs nas salas de origem e destino.

### Acervo bibliográfico

- Importação de planilhas XLSX com registros de livros.
- Uso do código de barras como identificador principal do exemplar.
- Mesclagem com item patrimonial existente quando houver patrimônio informado.
- Criação de itens de acervo quando não houver patrimônio.
- Resumo de importação com itens criados, mesclados, pulados e erros.

### Auditoria e acompanhamento

- Visualização de itens não localizados.
- Controle de duplicidades.
- Histórico de movimentações.
- Relatório de eventos.
- Painel de acompanhamento do progresso do inventário.

### Ajuda operacional

- Página de ajuda para usuários e suporte.
- Conteúdo separado por perfil de acesso.
- Orientações de atendimento nível 0 e nível 1.
- Procedimentos para conferência, leitura, importação, movimentações e auditoria.

## Perfis de acesso

O acesso é controlado por inventário. Um mesmo usuário pode ter papéis diferentes em ciclos distintos.

| Perfil | Descrição |
| --- | --- |
| `ADMIN` | Administrador global do sistema. Pode acessar recursos globais, relatórios de eventos e administração geral. |
| `ADMIN_CICLO` | Administrador de um inventário específico. Gerencia usuários, dados, backups, movimentações e configurações do ciclo. |
| `REVISOR` | Responsável por validação, revisão, lacre e auditoria operacional das salas. |
| `CONFERENTE` | Usuário de campo responsável por conferir itens nas salas e registrar ocorrências. |
| `VISUALIZADOR` | Acesso de consulta, sem permissão para alterar dados operacionais. |

## Arquitetura

O repositório é organizado em duas aplicações principais:

```text
campus-inventory/
├── backend/    # API Node.js, Express, Prisma e PostgreSQL
├── frontend/   # Interface web Next.js e React
├── docker-compose.yml
└── .specify/   # Especificações funcionais e decisões do sistema
```

### Backend

Tecnologias principais:

- Node.js;
- Express;
- Prisma ORM;
- PostgreSQL;
- JWT;
- integração LDAP/Active Directory;
- ExcelJS para leitura de XLSX.

Scripts úteis:

```bash
cd backend
pnpm dev
pnpm start
pnpm test
pnpm prisma:generate
pnpm prisma:migrate
pnpm seed
pnpm seed:books
```

### Frontend

Tecnologias principais:

- Next.js;
- React;
- Tailwind CSS;
- Axios;
- LocalForage para apoio a dados locais/offline.

Scripts úteis:

```bash
cd frontend
pnpm dev
pnpm build
pnpm start
```

## Como executar localmente

### Pré-requisitos

- Node.js compatível com Next.js 15;
- pnpm;
- Docker e Docker Compose;
- PostgreSQL acessível;
- credenciais LDAP/AD, quando a autenticação institucional estiver habilitada.

### Usando Docker Compose

Na raiz do projeto:

```bash
docker compose up --build
```

Serviços configurados no `docker-compose.yml`:

- frontend: `http://localhost:3033`;
- backend: `http://localhost:8088`.

O frontend usa `NEXT_PUBLIC_API_URL=/api`, assumindo proxy ou roteamento configurado no ambiente.

### Execução manual

Backend:

```bash
cd backend
pnpm install
pnpm prisma generate
pnpm prisma migrate deploy
pnpm dev
```

Frontend:

```bash
cd frontend
pnpm install
pnpm dev
```

Por padrão, o frontend local sobe em:

```text
http://localhost:3000
```

## Variáveis de ambiente

O backend depende principalmente das seguintes variáveis:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | String de conexão PostgreSQL. |
| `JWT_SECRET` | Segredo usado para assinatura dos tokens JWT. |
| `LDAP_URL` | Endereço do servidor LDAP/AD. |
| `LDAP_BASE_DN` | Base DN para busca de usuários. |
| `LDAP_DOMAIN` | Domínio institucional. |
| `LDAP_BIND_USER` | Usuário técnico para consultas no AD. |
| `LDAP_BIND_PASS` | Senha do usuário técnico. |
| `XLSX_PATH` | Caminho padrão para importações/seeds via XLSX. |

O frontend usa:

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | URL base da API consumida pela interface. |

Importante: os valores existentes no `docker-compose.yml` devem ser tratados como configuração local/de desenvolvimento. Para produção, use secrets, variáveis de ambiente protegidas ou mecanismo equivalente da infraestrutura.

## Banco de dados e integridade

O modelo de dados usa Prisma com PostgreSQL.

Algumas regras importantes:

- cada inventário mantém seus próprios espaços, itens, usuários e histórico;
- usuários são vinculados explicitamente aos inventários;
- o patrimônio é indexado para busca;
- exemplares de acervo bibliográfico usam `codigoBarras` como identificador principal;
- livros podem existir sem número de patrimônio;
- movimentações geram histórico do item e logs nas salas envolvidas;
- alterações relevantes preservam rastreabilidade de usuário, data e ação.

## Fluxo básico de uso

1. O usuário entra com credenciais institucionais.
2. O sistema lista apenas os inventários autorizados para aquele usuário.
3. O usuário seleciona o inventário ativo.
4. O dashboard exibe espaços, pendências, duplicatas e ações permitidas.
5. O conferente acessa uma sala e registra a conferência dos itens.
6. O revisor valida divergências, lacra salas e acompanha auditoria.
7. O administrador do ciclo gerencia dados, usuários, backups, importações e movimentações.
8. O histórico fica disponível para auditoria e suporte.

## Documentação interna

As especificações funcionais, decisões técnicas e plano de execução ficam em:

```text
.specify/specs/001-campus-inventory/
```

Arquivos relevantes:

- `spec.md`: especificação funcional;
- `plan.md`: plano técnico;
- `tasks.md`: fases e tarefas;
- `DECISIONS.md`: decisões arquiteturais;
- `execution-report.md`: relatório de execução.

## Testes e validação

Backend:

```bash
cd backend
pnpm test
```

Frontend:

```bash
cd frontend
pnpm build
```

Validação Prisma:

```bash
cd backend
pnpm prisma generate
pnpm prisma migrate deploy
```

## Segurança operacional

Boas práticas recomendadas:

- não versionar credenciais reais;
- trocar `JWT_SECRET` em produção;
- proteger variáveis LDAP e banco de dados;
- restringir acesso administrativo por perfil;
- manter backups antes de migrações;
- validar planilhas antes de importações grandes;
- revisar logs de movimentação em caso de divergência física.

## Status do projeto

O sistema está em evolução ativa, com foco em inventário patrimonial, conferência de campo, movimentação de bens e integração de acervo bibliográfico.

As regras operacionais devem sempre respeitar os perfis de acesso, o inventário ativo e a trilha de auditoria.
