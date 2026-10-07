# Integração com a API do Clínica nas Nuvens

Voltar ao [índice](README.md). Referência: [apidocs.json](../apidocs.json) (Swagger 2.0, host `api.clinicanasnuvens.com.br`).

## Para que serve

É a fonte das faltas e o lugar onde o bloqueio e a liberação acontecem. Todos os workflows usam a mesma URL base, a mesma credencial e o mesmo header.

## Quando é chamada

| Momento | Fluxo | Chamadas |
|---|---|---|
| 01:00 | [Bloqueio](bloqueio.md) | `GET /agenda/lista` (paginado), `GET /paciente/{id}` e `GET /executor-agenda/{id}` por falta, `PATCH /paciente/{id}/status` por paciente a bloquear |
| Liberar no painel | [Ações](fluxos/acoes.md) | `GET /paciente/{id}` (confere `ativo`), `PATCH /paciente/{id}/status` com `{ "ativo": true }` |
| Bloquear no painel | [Ações](fluxos/acoes.md) | `GET /agenda/lista` com `codigoPaciente`, `GET /paciente/{id}` e `GET /executor-agenda/{id}` por falta nova, `GET /paciente/{id}`, `PATCH` com `{ "ativo": false }` |
| Detalhe no painel | [Leitura](fluxos/leitura.md) | `GET /paciente/{id}` (status ao vivo; só leitura) |
| ~~02:00~~ | [Liberação](liberacao.md) (desativada) | — |

## Autenticação

- Basic auth pela credencial `API CNN AUTH` do n8n (`genericAuthType: httpBasicAuth`). Usuário e senha ficam só no n8n.
- Header `clinicaNasNuvens-cid` em toda requisição. Identifica a clínica. O Swagger declara esse header em todos os endpoints.
- O valor do header está escrito em cada nó HTTP. Não copie para documentos.

```mermaid
flowchart LR
    N["Nó HTTP Request"] -->|"Authorization: Basic (API CNN AUTH)"| A["api.clinicanasnuvens.com.br"]
    N -->|"clinicaNasNuvens-cid"| A
    A -->|"200 JSON"| N
    A -->|"401 / 403 / 404"| E["item de erro<br/>(onError: continueRegularOutput)"]
```

## Endpoints

### `GET /agenda/lista`

| Parâmetro | Valor usado | Observação |
|---|---|---|
| `dataInicial` | 1/8 do ciclo (`yyyy-08-01`) | Calculado com `$now.setZone('America/Sao_Paulo')` |
| `dataFinal` | Hoje (`yyyy-MM-dd`) | |
| `dataPor` | `AGENDAMENTO` | O Swagger aceita `AGENDAMENTO` ou `CRIACAO` |
| `pagina` | `0`, depois `$pageCount` | Atualizado a cada página |
| `registrosPorPagina` | `100` | |

A resposta é `PageAPI«AgendaFormRetornoAPI»`, com os agendamentos em `lista`. Campos lidos pelo fluxo:

| Campo | Uso |
|---|---|
| `id` | `IdAgenda` |
| `idPaciente` | `IdPaciente` e chamada ao `GET /paciente/{id}` |
| `data` | `DataFalta` (10 primeiros caracteres) |
| `horaInicio`, `horaFim` | `HoraInicio`, `HoraFim` |
| `status` | Filtro `FALTOU` e `StatusAgenda` |
| `idPessoaExecutor` | `IdPessoaExecutor` e chamada ao `GET /executor-agenda/{id}` |
| `idLocalAgenda`, `idTipoConsulta` | Colunas de mesmo nome |
| `observacoes` | `Observacoes` |
| `emailPaciente`, `telefoneCelularPaciente` | Reserva quando o paciente não tem contato |

Status que o Swagger lista: `AGENDADO`, `CONFIRMADO`, `CONFIRMADO_PACIENTE`, `CANCELADO`, `CANCELADO_PACIENTE`, `EM_ESPERA`, `EM_ANDAMENTO`, `FINALIZADO`, `FALTOU`, `PAGAMENTO`, `PRE_ATENDIMENTO`, `REMARCOU`. Só `FALTOU` interessa.

### `GET /paciente/{id}`

Resposta `PacienteRetornoAPI`. Campos lidos:

| Campo | Uso |
|---|---|
| `id` | Confere se a resposta é válida |
| `nome` | `NomePaciente` |
| `cpfcnpj` | `CpfCnpj` |
| `contato.email` | `EmailPaciente` |
| `contato.telefoneCelular` | `TelefonePaciente` |
| `ativo` | Bloqueio: pula quem já está `false`. Liberação: só segue quem está `false` |

O Swagger traz `ativo` como booleano, sem explicar o significado. Na prática `true` = ativo (liberado) e `false` = inativo (bloqueado).

### `GET /executor-agenda/{id}`

O `{id}` enviado é o `idPessoaExecutor` do agendamento. Resposta `ExecutorAgendaDetalhadoRetornoAPI`:

| Campo | Uso |
|---|---|
| `id` | `IdExecutorAgenda` |
| `nome` | `NomeExecutor` |
| `tipoExecutor` | `TipoExecutor` (`PROFISSIONAL` ou `CLIENTE_FORNECEDOR`) |

### `PATCH /paciente/{id}/status`

| Fluxo | Corpo | Efeito |
|---|---|---|
| Bloqueio | `{ "ativo": false }` | Inativa o paciente |
| Liberação | `{ "ativo": true }` | Ativa o paciente |

Esse endpoint não está no `apidocs.json`. O corpo é uma expressão n8n inteira (`={{ { ativo: false } }}`), não JSON com `{{ }}` no meio.

## Limites e ritmo

| Item | Valor | Nó |
|---|---|---|
| Registros por página | 100 | `GET agenda desde 1 ago` |
| Máximo de requisições da agenda | 100 (`maxRequests`, `limitPagesFetched: true`) | `GET agenda desde 1 ago` |
| Intervalo entre páginas | 200 ms (`requestInterval`) | `GET agenda desde 1 ago` |
| Fim da paginação | `Array.isArray($response.body.lista) && $response.body.lista.length === 0` | `GET agenda desde 1 ago` |
| GET de paciente e executor | 1 por vez (`batchSize: 1`), sem intervalo | `GET paciente por id`, `GET executor da agenda` |
| PATCH | 1 por vez, 3000 ms entre chamadas (`batchInterval`) | `PATCH status paciente` |

Com 100 páginas de 100, o teto é 10.000 agendamentos por execução do bloqueio. O PATCH leva cerca de 3 s por paciente.

## Erros

Todos os nós HTTP usam `onError: continueRegularOutput`. A resposta de erro vira um item comum. Os nós de código tratam como ausente a resposta com `error`, `message` ou sem `id`:

| Chamada que falhou | Efeito |
|---|---|
| `GET /agenda/lista` | Sem `lista`, o bloqueio termina como "sem faltas" |
| `GET /paciente/{id}` no bloqueio | A falta é gravada com `NomePaciente` e `CpfCnpj` `NULL` (e-mail e telefone caem no que veio do agendamento). O PATCH é enviado mesmo assim |
| `GET /executor-agenda/{id}` | A falta é gravada com `IdExecutorAgenda`, `NomeExecutor` e `TipoExecutor` `NULL` |
| `GET /paciente/{id}` na liberação | O paciente é pulado e volta a ser tentado na noite seguinte |
| `PATCH /paciente/{id}/status` | Nada é refeito na execução. No dia seguinte o fluxo tenta de novo, porque relê tudo |

Uma linha gravada com `NULL` não é completada depois: o `IF NOT EXISTS` por `IdAgenda` impede um novo insert.
