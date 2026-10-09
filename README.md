# CNN — Bloqueio por falta e painel de liberação

Bloqueia no Clínica nas Nuvens (CNN) o paciente que faltou e deixa a **liberação manual**, num painel web com rastreabilidade.

| Peça | Onde | O que faz |
|---|---|---|
| Bloqueio automático | n8n, `workflows/bloqueioPacientesFaltas.json`, 01:00 | Grava as faltas, bloqueia (`{ "ativo": false }`) e registra cada PATCH na auditoria |
| Painel | Vercel (HTML estático + `api/`) | Lista os bloqueados, libera, bloqueia um paciente, mostra relatórios, histórico e configuração |
| CNN Painel - Leitura | n8n, `workflows/cnn-painel-leitura.json` (webhook) | Consultas do painel (só leitura) |
| CNN Painel - Ações | n8n, `workflows/cnn-painel-acoes.json` (webhook) | Liberar e bloquear pelo painel, com auditoria |
| CNN Painel - Usuários | n8n, `workflows/cnn-painel-usuarios.json` (webhook) | Login e gestão de usuários (perfis Leitor, Editor, Admin) |
| Liberação automática | n8n, `workflows/liberacaoPacientesFaltasautomaticas--Desativado.json` | **Desativada.** Substituída pela liberação manual |
| Banco | SQL Server `INTEGRACAO` | `CtlCnnFaltaPaciente` (faltas), `CtlCnnFaltaProcedimento` (procedimentos), `CtlCnnCadastro` (nomes do CNN), `CtlCnnControlePaciente` (controle), `CtlCnnAcaoPaciente` (auditoria), `CtlCnnUsuario` e `CtlCnnUsuarioEvento` (usuários) |

```mermaid
flowchart LR
    U["Navegador"] -- "Bearer (sessão assinada)" --> V["Vercel /api"]
    V -- "POST { action } + X-Monitor-Key" --> L["n8n Leitura"]
    V -- "POST { action } + X-Monitor-Key" --> A["n8n Ações"]
    V -- "POST { action } + X-Monitor-Key" --> US["n8n Usuários"]
    US --> DB
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

Ciclo: começa em 1º de outubro. Fonte única: [`workflows/code/_regra.js`](workflows/code/_regra.js). A liberação pelo painel pode ser antes do prazo, com motivo obrigatório; o bloqueio das 01:00 respeita essa liberação até surgir uma falta nova.

## Comandos

```bash
npm run dev       # servidor local em http://localhost:3000 (lê .env.local)
npm run inject    # copia workflows/code/*.js para dentro dos JSON dos workflows
npm run check     # confere os workflows (compila o código dos nós, referências, inject em dia)
npm run admin    # gera senha aleatória e o INSERT do primeiro admin (colar no SSMS)
```

Sem dependências de npm: Node 20.6 ou mais novo.

## Usuários e perfis

| Perfil | Pode |
|---|---|
| Leitor | Ver pacientes, relatórios, histórico e configuração |
| Editor | Tudo do leitor, mais liberar, bloquear, isentar e registrar |
| Admin | Tudo do editor, mais a tela **Usuários** (criar, mudar perfil, desativar, redefinir senha) |

Os usuários ficam no banco (`CtlCnnUsuario`), não em variável de ambiente. O primeiro admin é inserido à mão (`npm run admin`); os demais, pela tela. Ver [docs/operacao.md](docs/operacao.md#usuários-do-painel).

## Documentação

- **Para todos:** [docs/visao-geral.md](docs/visao-geral.md) (sem termos técnicos) e [docs/regras.md](docs/regras.md) (as regras de negócio).
- **Word:** [docs/word/](docs/word/), gerado com `npm run word`.

[docs/README.md](docs/README.md): índice, arquitetura, banco, painel, um documento por workflow e operação (instalação, corte da liberação automática, deploy).
