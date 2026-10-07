# Changelog

Mudanças que afetam quem usa ou opera, por data. Cada entrada em Adicionado / Alterado / Corrigido.

## 2026-10-06 — Bloqueio de todo o período

### Corrigido

- **Bloqueio (01:00):** passa a bloquear **todo paciente com falta no período** (do início do ciclo até hoje) que esteja ativo no CNN. Antes só bloqueava quem ainda estava dentro do prazo 60/90/180, regra que veio do fluxo original. O prazo agora só diz a partir de quando o paciente pode ser **liberado**.
- Bloquear pelo painel deixa de recusar falta com prazo vencido.
- No painel, falta sem bloqueio registrado aparece como "Aguardando bloqueio" mesmo com o prazo vencido. "Apto a liberar" fica só para quem tem bloqueio registrado e já cumpriu o prazo.
- Liberar paciente ainda ativo e sem bloqueio registrado responde `NAO_BLOQUEADO` (isentar a falta) também com o prazo vencido.

Continua valendo: quem foi liberado ou isento pelo painel por aquela falta não é bloqueado de novo; quem já está inativo no CNN não recebe PATCH, só é registrado.

## 2026-10-06 — Aguardando bloqueio

### Adicionado

- Novo status **Aguardando bloqueio**: falta no prazo sem bloqueio registrado. Antes esses pacientes apareciam como "Bloqueado" mesmo sem nenhum PATCH no CNN. O painel ganha um contador e um filtro para eles, e a lista mostra o botão Bloquear.
- No detalhe, para quem está aguardando e ativo no CNN: **Bloquear no CNN** ou **Isentar esta falta** (registra sem PATCH; o bloqueio das 01:00 deixa de bloquear por ela).
- Liberar um paciente ativo no CNN sem bloqueio registrado responde `NAO_BLOQUEADO` ("ainda não foi bloqueado") em vez de `JA_ATIVO`, e o painel oferece a isenção, não "registrar liberação".

### Alterado

- **Bloqueio (01:00):** quem já está inativo no CNN e não tem bloqueio registrado para a falta vigente passa a ser registrado (auditoria + controle) sem PATCH (nó `enviar ao CNN?`).
- A carga inicial do controle só deve rodar se a automação antiga de fato bloqueou os pacientes.
- **Bloqueio (01:00):** quando não há ninguém a bloquear (por exemplo, todos com prazo vencido), `montar info bloqueio` devolve um item de resumo em vez de lista vazia, e o fluxo termina no nó `nada a bloquear` mostrando o motivo. Antes a execução parava sem saída nesse nó.

## 2026-10-05 — Registrar situação feita direto no CNN

### Adicionado

- Liberar um paciente que já está ativo no CNN (ou bloquear um que já está inativo) não para mais no erro: o painel pergunta se registra a situação. Confirmando, grava controle e auditoria **sem PATCH** ("Só registro" no histórico), e o bloqueio das 01:00 deixa de considerar essa falta.
- O detalhe do paciente avisa quando banco e CNN divergem e mostra o botão "Registrar liberação feita no CNN".
- Workflow Ações: nó `enviar ao CNN?`; resposta 409 com `codigo` (`JA_ATIVO` / `JA_BLOQUEADO`); parâmetro `apenasRegistrar`.

## 2026-10-04 — Painel de liberação manual

A liberação deixou de ser automática (pedido da reunião com a equipe). Entra um painel com rastreabilidade.

### Adicionado

- Painel web (Vercel): **Pacientes** (bloqueados, aptos a liberar, liberados antes do prazo; botões Liberar e Bloquear; detalhe com faltas, histórico e status ao vivo no CNN), **Relatórios de faltas** (por mês, dia da semana, profissional, reincidência; exportação CSV sem dados de contato), **Histórico de ações** (auditoria com filtros) e **Configuração** (parâmetros em uso, só leitura).
- Login individual (`DASHBOARD_USERS`, senha com hash scrypt). Cada ação fica no nome de quem fez.
- Workflow **CNN Painel - Leitura** (webhook, só leitura) e **CNN Painel - Ações** (webhook: liberar e bloquear um paciente).
- Tabelas `dbo.CtlCnnControlePaciente` (situação atual de cada paciente) e `dbo.CtlCnnAcaoPaciente` (auditoria de cada PATCH): `sql/criar_tabelas_painel.sql`.
- `sql/carga_inicial_controle.sql`, para rodar no corte da liberação automática.
- `workflows/code/`: código dos nós Code em arquivos, `_regra.js` (prazos e ciclo, fonte única) e `_sql.js` (helpers), copiados para os JSON por `npm run inject`. `npm run check` confere os workflows.

### Alterado

- **Bloqueio (01:00):** não bloqueia de novo quem foi liberado pelo painel com a mesma falta vigente; cada PATCH vira linha na auditoria (`Origem = AUTOMATICO`) e atualiza a tabela de controle. Os SQL passaram a ser montados nos nós Code (`={{ $json.query }}`), com o mesmo texto de antes.
- **Liberação automática (02:00): desativada.** O gatilho ficou `disabled` no JSON; o workflow deve ficar inativo no n8n.
- Os JSON dos workflows foram para `workflows/`.
