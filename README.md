# CNN — Bloqueio por falta e painel de liberação

Bloqueia no Clínica nas Nuvens (CNN) o paciente que faltou e deixa a **liberação manual**, num painel web com rastreabilidade.

| Peça | Onde | O que faz |
|---|---|---|
| Bloqueio automático | n8n, `workflows/bloqueioPacientesFaltas.json`, 01:00 | Grava as faltas, bloqueia (`{ "ativo": false }`) e registra cada PATCH na auditoria |
| Painel | Vercel (HTML estático + `api/`) | Lista os bloqueados, libera, bloqueia um paciente, mostra relatórios, histórico e configuração |
| CNN Painel - Leitura | n8n, `workflows/cnn-painel-leitura.json` (webhook) | Consultas do painel (só leitura) |
| CNN Painel - Ações | n8n, `workflows/cnn-painel-acoes.json` (webhook) | Liberar e bloquear pelo painel, com auditoria |
| Liberação automática | n8n, `workflows/liberacaoPacientesFaltas.json` | **Desativada.** Substituída pela liberação manual |
| Banco | SQL Server `INTEGRACAO` | `CtlCnnFaltaPaciente` (faltas), `CtlCnnControlePaciente` (controle), `CtlCnnAcaoPaciente` (auditoria) |

```mermaid
flowchart LR
    U["Navegador"] -- "Basic Auth (usuário próprio)" --> V["Vercel /api"]
    V -- "POST { action } + X-Monitor-Key" --> L["n8n Leitura"]
    V -- "POST { action } + X-Monitor-Key" --> A["n8n Ações"]
    B["n8n Bloqueio 01:00"] --> CNN["API CNN"]
    A --> CNN
    L --> DB[("SQL Server")]
    A --> DB
    B --> DB
```

## Regra

**Bloqueio:** todo paciente com falta no período analisado (do início do ciclo até hoje) é bloqueado se estiver ativo no CNN. Quem já está inativo não recebe PATCH, só é registrado.

**Liberação (manual, pelo painel):** o prazo conta da falta vigente e diz a partir de quando o paciente pode ser liberado.

| Falta vigente no ciclo | Pode ser liberado após |
|---|---|
| 1ª | 60 dias a partir da data dessa falta |
| 2ª | 90 dias |
| 3ª ou mais | 180 dias |

Ciclo: começa em 1º de agosto. Fonte única: [`workflows/code/_regra.js`](workflows/code/_regra.js). A liberação pelo painel pode ser antes do prazo, com motivo obrigatório; o bloqueio das 01:00 respeita essa liberação até surgir uma falta nova.

## Comandos

```bash
npm run dev       # servidor local em http://localhost:3000 (lê .env.local)
npm run inject    # copia workflows/code/*.js para dentro dos JSON dos workflows
npm run check     # confere os workflows (compila o código dos nós, referências, inject em dia)
npm run senha -- joao   # gera a entrada de um usuário para DASHBOARD_USERS
```

Sem dependências de npm: Node 20.6 ou mais novo.

## Documentação

[docs/README.md](docs/README.md): índice, arquitetura, banco, painel, um documento por workflow e operação (instalação, corte da liberação automática, deploy).
