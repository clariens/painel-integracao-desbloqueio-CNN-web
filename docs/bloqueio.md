# Fluxo de bloqueio por falta

Voltar ao [índice](README.md). Arquivo: [workflows/bloqueioPacientesFaltas.json](../workflows/bloqueioPacientesFaltas.json). Código dos nós: `workflows/code/bloqueio-*.js`, com a regra em [`_regra.js`](../workflows/code/_regra.js).

## Para que serve

Acha os agendamentos com status `FALTOU` no ciclo, grava cada falta nova em `dbo.CtlCnnFaltaPaciente` e bloqueia no CNN (`{ "ativo": false }`) **todo paciente com falta no período que esteja ativo**. O prazo 60/90/180 não entra nessa decisão. Cada PATCH vira uma linha na auditoria (`dbo.CtlCnnAcaoPaciente`, `Origem = AUTOMATICO`) e atualiza a tabela de controle.

Não libera ninguém. A liberação é manual, pelo painel ([fluxos/acoes.md](fluxos/acoes.md)). Quem foi liberado pelo painel **não é bloqueado de novo pela mesma falta vigente**; uma falta nova bloqueia normalmente.

O botão **Bloquear** do painel reutiliza o código deste fluxo (`separar faltas`, `preparar insert SQL`) para um paciente só.

## Quando roda

- Todo dia à 01:00, pelo nó `Todo dia 01:00` (cron `0 1 * * *`).
- Não há gatilho manual no workflow. Para testar, execute pelo editor do n8n.
- O horário do cron segue o fuso do n8n, que precisa ser `America/Sao_Paulo`.

## Regra

- **Bloqueia todo paciente com falta no período** (de 1/10 do ciclo até hoje) que esteja **ativo** no CNN, **enquanto o prazo da falta vigente corre**.
- **Quem já cumpriu o prazo não é bloqueado** (por exemplo, uma falta lançada atrasada no CNN). Até 22/10/2026 o prazo não decidia o bloqueio; agora, com a [liberação automática das 02:00](liberacao.md), bloquear quem já cumpriu o prazo só para liberar uma hora depois não faz sentido.
- O prazo é gravado no controle (`DataFimBloqueio`). Quando termina, a liberação automática libera. Antes disso, só com uma [solicitação de desbloqueio](fluxos/solicitacoes.md) aprovada.

| `NumeroFalta` vigente | Bloqueio dura |
|---|---|
| 1 | 60 dias |
| 2 | 90 dias |
| 3 ou mais | 180 dias |

- Falta vigente = a linha com `MAX(NumeroFalta)` do paciente desde 1/10 do ciclo.
- Início do prazo = `DataFalta` dessa linha. Fim = início + dias.
- Não bloqueia quem está `LIBERADO` na tabela de controle com `IdAgendaReferencia` igual à falta vigente (liberado ou isento pelo painel).
- Quem **já está inativo** no CNN não recebe PATCH. Se ainda não há bloqueio registrado para a falta vigente, o paciente entra no laço só para **registrar** (`apenasRegistrar`). O controle passa a espelhar o CNN, e o painel tira o paciente de "Aguardando bloqueio".
- Ciclo: de outubro a dezembro, 1/10 do ano corrente. De janeiro a setembro, 1/10 do ano anterior. (Até 08/10/2026 o ciclo começava em 1/8.)

Exemplo: 1ª falta em 2026-08-03 → bloqueado na execução seguinte e liberável a partir de 2026-10-02. Se a 2ª falta vier em 2026-09-10, a vigente passa a ser a 2ª e o paciente só pode ser liberado a partir de 2026-12-09 (90 dias a partir de 2026-09-10). Se ele ainda estiver ativo em 10/10 com essa falta (por exemplo, porque o fluxo não rodou), é bloqueado mesmo assim.

```mermaid
gantt
    title Exemplo de prazo com duas faltas no ciclo
    dateFormat YYYY-MM-DD
    axisFormat %d/%m
    todayMarker off
    section Falta 1
    Prazo de 60 dias (substituído)  :done, f1, 2026-08-03, 60d
    section Falta 2
    Prazo de 90 dias (vigente)      :active, f2, 2026-09-10, 90d
```

## Fluxograma

O fluxo tem duas partes: primeiro ele lê a agenda e grava as faltas; depois decide quem bloquear e bloqueia no CNN.

### Parte 1: ler a agenda e gravar as faltas

```mermaid
flowchart TD
    T(["Todo dia 01:00"]) --> K["5 listas de cadastro<br/>tipo de consulta, executores,<br/>rótulos, locais, especialidades"]
    K --> A["GET agenda do ciclo<br/>TODAS as páginas, 100 por página"]
    A --> S["separar faltas<br/>status FALTOU, data no ciclo"]
    S --> Q{"sem faltas<br/>no período?"}
    Q -->|"sim"| Z(["sem faltas<br/>SELECT 0 e fim"])
    Q -->|"não"| U["pacientes únicos<br/>1 item por paciente"]
    U --> P["GET paciente por id<br/>1 chamada por paciente"]
    P --> I["preparar insert SQL<br/>uma query: cadastros,<br/>faltas, procedimentos"]
    I --> G["gravar faltas<br/>transação + renumeração"]
    G --> D(["segue para a parte 2"])
```

### Parte 2: decidir quem bloquear e bloquear no CNN

```mermaid
flowchart TD
    D(["vindo da parte 1"]) --> IDS["ids da consulta<br/>IdPaciente do lote"]
    IDS --> C["consultar bloqueios<br/>falta vigente de cada paciente,<br/>menos liberados no painel"]
    C --> M{"montar info bloqueio<br/>falta no período e não<br/>liberado no painel?"}
    M -->|"não"| X(["fica de fora"])
    M -->|"ninguém"| N(["nada a bloquear<br/>item de resumo"])
    M -->|"sim"| L["loop bloqueios"]
    L -->|"próximo"| EC{"enviar ao CNN?"}
    EC -->|"não (já inativo)"| RG
    EC -->|"sim"| H["PATCH status paciente<br/>ativo: false"]
    H --> RG["montar registro"]
    RG --> RB["registrar bloqueio<br/>auditoria + controle"]
    RB --> L
    L -->|"acabou"| F(["fim"])
```

## Passo a passo

| # | Nó | Tipo | O que faz |
|---|---|---|---|
| 1 | `Todo dia 01:00` | Schedule Trigger | Dispara com o cron `0 1 * * *` |
| 1a | `GET tipos de consulta`, `GET executores`, `GET rótulos`, `GET locais`, `GET especialidades` | HTTP Request | Uma vez cada (`executeOnce`), paginados até `lista` vazia: `/tipo-consulta/lista`, `/executor-agenda/lista`, `/agenda-rotulo/lista`, `/local-agenda/lista`, `/especialidade/lista` (com `somenteAtivos=false` onde existe, para os nomes antigos também). Se um falhar, o bloqueio segue e só aquele nome não é atualizado |
| 2 | `GET agenda do ciclo` | HTTP Request | `GET /agenda/lista` de 1/10 do ciclo até hoje, `dataPor=AGENDAMENTO`, 100 por página, **todas as páginas**. Roda uma vez (`executeOnce`). Para quando `lista` volta vazia (ou a resposta não é uma página) ou após 1000 requisições. **A paginação não pode ser desligada**: a API devolve no máximo 100 agendamentos por chamada |
| 3 | [`separar faltas`](../workflows/code/bloqueio-separar-faltas.js) | Code | Fica com `status === 'FALTOU'`, com `id` e `idPaciente`, e `data` entre 1/10 e hoje. Ordena por data e `id`. Sem nenhuma, devolve um item `{ semFaltas: true }` |
| 4 | `sem faltas no periodo?` | If | `semFaltas = true` vai para o nó `sem faltas`. O resto segue |
| 5 | `sem faltas` | Microsoft SQL | `SELECT CAST(0 AS int) AS quantidadeFaltas`. Só fecha o ramo |
| 6 | [`pacientes únicos`](../workflows/code/bloqueio-pacientes-unicos.js) | Code | Um item por paciente distinto, para o GET seguinte rodar uma vez por paciente (e não por falta) |
| 7 | `GET paciente por id` | HTTP Request | `GET /paciente/{idPaciente}`, um paciente de cada vez. Traz nome, CPF, contato e o `ativo` usado no passo 12 |
| 8 | [`preparar insert SQL`](../workflows/code/bloqueio-preparar-insert.js) | Code | Monta **uma** query (o nó Microsoft SQL só executa a do 1º item): `MERGE` dos cadastros em `CtlCnnCadastro`; todas as faltas lidas numa tabela temporária `#faltas`; `UPDATE` das faltas já gravadas (tipo de consulta, rótulo, profissional, local, horário; dados do paciente só completam o que estiver vazio); `INSERT` das novas; procedimentos apagados e gravados de novo em `CtlCnnFaltaProcedimento`. Paciente e profissional são casados por id (`Map`), não pela posição |
| 9 | `gravar faltas` | Microsoft SQL | Executa a query de `preparar insert SQL` (`={{ $json.query }}`) numa transação (`SET XACT_ABORT ON`), com a renumeração de `NumeroFalta`. Devolve `faltasLidas`, `faltasNovas` e `cadastrosLidos` |
| 10 | [`ids da consulta`](../workflows/code/bloqueio-ids-consulta.js) | Code | Monta a consulta de `consultar bloqueios` com a lista de pacientes do lote. Se `preparar insert SQL` não rodou, não devolve nada |
| 11 | `consultar bloqueios` | Microsoft SQL | Devolve a linha vigente (`MAX(NumeroFalta)` no ciclo) de cada paciente do lote, **menos** quem está `LIBERADO` no controle com essa mesma falta |
| 12 | [`montar info bloqueio`](../workflows/code/bloqueio-montar-info.js) | Code | Emite um item por paciente com falta no período e **prazo correndo** (quem já cumpriu o prazo fica de fora e entra na contagem `prazoCumprido`); calcula o fim do prazo. Quem o GET trouxe `ativo: false` sai com `apenasRegistrar: true`, ou fica de fora se o controle já tem o bloqueio dessa falta |
| 12a | `há o que bloquear?` | If | Sem ninguém para bloquear, `montar info bloqueio` devolve um item `{ nadaABloquear: true }` com o resumo (analisados, já registrados, prazo cumprido). Esse item vai para o nó final `nada a bloquear`, e a execução termina mostrando o motivo |
| 13 | `loop bloqueios` | Split in Batches | Passa os itens um por vez |
| 13a | `enviar ao CNN?` | If | `apenasRegistrar` = true vai direto para `montar registro`, sem PATCH |
| 14 | `PATCH status paciente` | HTTP Request | `PATCH /paciente/{id}/status` com `={{ { ativo: false } }}`. 1 por vez, 3000 ms entre chamadas. Resposta completa (`fullResponse`, `neverError`) para guardar o status HTTP; timeout de 15 s |
| 15 | [`montar registro`](../workflows/code/bloqueio-montar-registro.js) | Code | Junta o paciente do laço (`$('loop bloqueios')`) e a resposta do PATCH. Monta o SQL de auditoria e controle (`sqlRegistrarAcao` de [`_sql.js`](../workflows/code/_sql.js)) |
| 16 | `registrar bloqueio` | Microsoft SQL | Numa transação: `INSERT` em `CtlCnnAcaoPaciente` (`Origem = AUTOMATICO`, `Usuario = n8n`, sucesso ou falha) e, se o PATCH deu certo, `MERGE` em `CtlCnnControlePaciente` (`BLOQUEADO`). Volta para o `loop bloqueios` |

### Como o `INSERT` é montado

`preparar insert SQL` usa quatro funções de conversão, de [`_sql.js`](../workflows/code/_sql.js):

| Função | Faz | Valor vazio ou inválido |
|---|---|---|
| `sqlN` | Número inteiro (`Math.trunc`) | `NULL` |
| `sqlS(valor, max)` | Texto `N'…'`, corta em `max` caracteres, dobra aspas simples | `NULL` |
| `sqlDate` | `CONVERT(date, 'yyyy-MM-dd', 23)` | `NULL` se não casar com `^\d{4}-\d{2}-\d{2}$` |
| `sqlTime` | `CONVERT(time(0), 'HH:mm:ss')`. Aceita `HH:mm` e completa `:00` | `NULL` |

De onde vem cada coluna gravada:

| Coluna | Origem |
|---|---|
| `IdAgenda` | `id` do agendamento |
| `IdPaciente` | `idPaciente` do agendamento |
| `NomePaciente` | `nome` do `GET /paciente` (200) |
| `CpfCnpj` | `cpfcnpj` do `GET /paciente` (20) |
| `EmailPaciente` | `contato.email` do paciente; senão `emailPaciente` do agendamento (200) |
| `TelefonePaciente` | `contato.telefoneCelular` do paciente; senão `telefoneCelularPaciente` do agendamento (30) |
| `DataFalta` | `dataFalta` (10 primeiros caracteres de `data`) |
| `HoraInicio`, `HoraFim` | `horaInicio`, `horaFim` do agendamento |
| `StatusAgenda` | `status` do agendamento (50) |
| `IdPessoaExecutor` | `idPessoaExecutor` do agendamento |
| `IdExecutorAgenda`, `NomeExecutor`, `TipoExecutor` | `id`, `nome` (200), `tipoExecutor` (50) do executor da `/executor-agenda/lista` cujo **`idpessoa`** é o `idPessoaExecutor` do agendamento |
| `IdLocalAgenda`, `IdTipoConsulta`, `IdRotulo` | Do agendamento (`idLocalAgenda`, `idTipoConsulta`, `idRotulo`). Os nomes ficam em `CtlCnnCadastro` |
| `Observacoes` | `observacoes` do agendamento (500) |
| `NumeroFalta` | Entra 0 e a renumeração acerta na mesma transação |
| `DataColeta` | Não é enviada. Default `SYSUTCDATETIME()` da tabela |

Os números entre parênteses são o corte feito por `sqlS`. Se o GET do paciente falhar, nome, CPF e contato ficam `NULL` e são completados numa noite seguinte (o `UPDATE` preenche o que estiver vazio).

Os procedimentos (`procedimentos[]` do agendamento) vão para `CtlCnnFaltaProcedimento`, uma linha por tipo de procedimento (quantidades do mesmo tipo somadas). Algumas clínicas não preenchem esse campo: aí a falta fica sem linha lá, e o tipo de consulta é o que diz o que o paciente ia fazer.

### Renumeração

Depois dos inserts, `gravar faltas` recalcula `NumeroFalta` com `ROW_NUMBER() OVER (PARTITION BY IdPaciente ORDER BY DataFalta, IdAgenda)`. Só para os pacientes do lote e só para `DataFalta >= 1/10 do ciclo`. Só atualiza linhas cujo número mudou.

Isso corrige a ordem quando uma falta mais antiga chega depois de uma mais nova.

## Entradas e saídas

| | O quê |
|---|---|
| Entrada | Agenda do ciclo (`GET /agenda/lista`) |
| Entrada | Ficha de cada paciente com falta (`GET /paciente/{id}`, uma por paciente) |
| Entrada | Listas de tipo de consulta, executores, rótulos, locais e especialidades |
| Entrada | Linhas já gravadas em `dbo.CtlCnnFaltaPaciente` |
| Saída | Linhas novas (e atualizadas) em `dbo.CtlCnnFaltaPaciente` e `NumeroFalta` renumerado |
| Saída | Procedimentos em `dbo.CtlCnnFaltaProcedimento` e nomes em `dbo.CtlCnnCadastro` |
| Saída | `PATCH /paciente/{id}/status` com `{ "ativo": false }` |
| Saída | Uma linha por PATCH em `dbo.CtlCnnAcaoPaciente` e a situação `BLOQUEADO` em `dbo.CtlCnnControlePaciente` |
| Saída | Itens da execução no n8n com `acao: 'BLOQUEAR'`, `dataFimBloqueio` e `mensagem` |

## Limites conhecidos

- **Relê o ciclo inteiro todo dia.** A agenda vem desde 1/10, todas as páginas, então o volume e o tempo crescem até setembro. Em outubro são ~80 páginas; um ano inteiro fica perto de 500. O teto é 1000 requisições × 100 = 100.000 agendamentos de qualquer status.
- **Chama o CNN por paciente.** `GET paciente por id` roda uma vez para cada paciente com falta no ciclo, inclusive os já gravados (é dele que sai o `ativo` usado no bloqueio).
- **Rebloqueia todo dia.** Se alguém reativar um paciente ainda no prazo **direto no CNN**, ele volta a ser bloqueado à 01:00 do dia seguinte. Pelo painel isso não acontece: a liberação fica no controle e é respeitada.
- **Auditoria depois do PATCH.** Se `registrar bloqueio` falhar, o paciente fica bloqueado no CNN sem linha na auditoria. O erro aparece na saída do nó, na execução do n8n.
- **Falta desfeita continua contando.** Se o status mudar de `FALTOU` para outro no CNN, a linha não é apagada e segue na contagem.
- **Nome e contato são fotografia.** São gravados no insert e não mudam depois; só são completados se estiverem vazios.
- **Erros não param o fluxo.** Todos os nós HTTP e SQL usam `onError: continueRegularOutput`. Ver [arquitetura.md](arquitetura.md#tratamento-de-erro).
- **Paciente sem `ativo` conhecido é bloqueado.** Se o GET do paciente falhou, ele não entra no mapa de `ativo` e o PATCH é enviado mesmo assim.
- **Formato de data.** O código assume que `data` do agendamento começa com `yyyy-MM-dd`.

## Configuração

| Item | Valor | Nó |
|---|---|---|
| Cron | `0 1 * * *` | `Todo dia 01:00` |
| Página | `registrosPorPagina=100`, `pagina` = `$pageCount` | `GET agenda do ciclo` |
| Fim da paginação | `lista` vazia ou resposta sem `lista` | `GET agenda do ciclo` e os 5 nós de cadastro |
| Máximo de requisições | `maxRequests: 1000` (agenda), `50` (cadastros) | `GET agenda do ciclo`, nós de cadastro |
| Intervalo entre páginas | `requestInterval: 200` ms | `GET agenda do ciclo` e nós de cadastro |
| Lote do GET de paciente | `batchSize: 1` | `GET paciente por id` |
| Lote do PATCH | `batchSize: 1`, `batchInterval: 3000` ms | `PATCH status paciente` |
| Corpo do PATCH | `={{ { ativo: false } }}` | `PATCH status paciente` |
| Prazos e ciclo | `REGRA` em [`_regra.js`](../workflows/code/_regra.js) | Nós Code (via `npm run inject`) e URL de `GET agenda do ciclo` (1/10 escrito na expressão) |
| Credenciais | `API CNN AUTH`, `TST Araguari` | Nós HTTP e SQL |

O corpo do PATCH precisa ser uma expressão inteira. Colocar `{{ }}` no meio de um JSON estático quebra o envio.

O código dos nós Code não se edita no n8n: edite `workflows/code/*.js`, rode `npm run inject` e `npm run check` e cole o JSON. Ver [operacao.md](operacao.md#como-publicar-cada-tipo-de-mudança).
