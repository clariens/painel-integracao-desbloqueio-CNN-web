# Changelog

Mudanças que afetam quem usa ou opera, por data. Cada entrada em Adicionado / Alterado / Corrigido.

## 2026-10-16 — Segurança: cabeçalhos e documentação

### Adicionado

- **Cabeçalhos de segurança** em todas as respostas ([vercel.json](vercel.json)): `X-Frame-Options: DENY`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e `Permissions-Policy`. O servidor local (`npm run dev`) aplica os mesmos cabeçalhos do `vercel.json`.
- **[docs/seguranca.md](docs/seguranca.md):** camadas, login e perfis, onde fica cada segredo, como criar e trocar as chaves, proteções no código, como testar, riscos conhecidos e quem tem acesso a quê. Também em Word (`15 - Segurança (técnica).docx`).
- **[docs/seguranca-resumo.md](docs/seguranca-resumo.md):** resumo de segurança para a liderança, sem termos técnicos: as quatro barreiras, perfis, registro das ações, LGPD, situações do tipo "e se acontecer…", o que já está implantado e próximos passos recomendados. Em Word: `02 - Segurança (resumo para a liderança).docx`.

### Alterado

- **Word:** as colunas das tabelas passam a ter largura proporcional ao conteúdo (uma coluna "#" não ocupa mais o mesmo espaço que uma de descrição), e uma linha de tabela não é mais quebrada entre duas páginas. Os documentos foram renumerados (o resumo de segurança entrou como 02).

## 2026-10-08 — Documentação completa e versão em Word

### Adicionado

- **[docs/visao-geral.md](docs/visao-geral.md):** visão geral para quem não é técnico (o que o sistema faz, telas, situações do paciente, perfis, perguntas frequentes e glossário), com diagramas.
- **[docs/regras.md](docs/regras.md):** todas as regras de negócio numeradas (R1 a R69), cada uma com onde está implementada.
- **Gerador de Word** em `docs/word/gerador/` (`npm run word`): cada documento vira um `.docx` com capa, sumário, cabeçalho, rodapé, tabelas formatadas e os diagramas como imagens; `00 - Documentação completa.docx` junta todos.

### Alterado

- Documentação atualizada para o estado atual: diagrama do banco com as sete tabelas, sequência do bloqueio (listas de cadastro, todas as páginas, GET por paciente), APIs usadas, camada de cache do painel, checklist de implantação completo, workflow de liberação renomeado e publicação direto na `main`.
- Diagramas grandes divididos em partes para ficarem legíveis no Word: bloqueio, ações, banco de dados (três partes), arquitetura (caminho da requisição e credenciais) e script SQL.

### Corrigido

- **[docs/script-sql.md](docs/script-sql.md):** `criar_tabelas_bloqueio.sql` descrito com as três tabelas que ele cria (faltas, procedimentos e cadastros), números de linha atualizados e contagem de colunas esperada no `SELECT` de conferência.

## 2026-10-08 — Ciclo em 1º de outubro, procedimento na lista e cache entre telas

### Alterado

- **O ciclo passa a começar em 1º de outubro** (antes, 1º de agosto): `_regra.js`, URL do nó de agenda (renomeado para `GET agenda do ciclo`), atalhos dos Relatórios e `sql/carga_inicial_controle.sql`. Colar de novo bloqueio, Leitura e Ações no n8n.
- **Pacientes:** o procedimento aparece em vermelho ao lado da data da falta (sem procedimento, o tipo de consulta); "faltas no ciclo" vira um selo ao lado do nome; menu lateral mais estreito.

### Adicionado

- **Tela "Preparando os dados…" ao entrar:** busca todas as telas em paralelo; depois, a navegação não espera o n8n. Dado vencido aparece na hora e é atualizado em segundo plano.
- **Cache entre telas** (sessionStorage, por aba): trocar de tela não chama a API dentro do prazo (Pacientes 2 min, detalhe 1 min, Relatórios 10 min por período, Histórico 2 min, Configuração 30 min, Usuários 2 min). Pré-carga das telas mais usadas, filtros lembrados por tela, "Atualizar agora" força a busca e uma ação limpa só o que ela muda.

## 2026-10-08 — Agenda completa, profissional, tipo de consulta e procedimentos

### Corrigido

- **Bloqueio (01:00) lê todas as páginas da agenda.** A API devolve no máximo 100 agendamentos por chamada; com a paginação desligada no n8n só a 1ª página era lida (só faltas de um dia). O teto sobe de 100 para 1000 páginas, e a paginação para também quando a resposta não é uma página (erro).
- **Nome do profissional vinha sempre vazio.** O fluxo chamava `/executor-agenda/{idPessoaExecutor}`, mas esse endpoint espera outro id. Agora lê `/executor-agenda/lista` uma vez e casa pelo `idpessoa`. As faltas já gravadas ganham o nome pela Leitura, sem reprocessar.

### Adicionado

- Gravação do **tipo de consulta** (nome), do **rótulo** da agenda e dos **procedimentos** de cada falta (`CtlCnnFaltaProcedimento`), e dos nomes das listas do CNN em `CtlCnnCadastro` (tipo de consulta, profissional, rótulo, local, especialidade).
- **Pacientes:** tipo de consulta, procedimentos e profissional embaixo da falta vigente; filtro por tipo de consulta; no detalhe, o que o paciente ia fazer em cada falta.
- **Relatórios:** faltas por tipo de consulta, por período do dia, por rótulo e procedimentos com mais faltas; o CSV ganha tipo de consulta, procedimentos e rótulo.
- **Configuração:** quantos cadastros do CNN estão carregados e quando foram atualizados.

### Alterado

- `GET paciente por id` roda uma vez por paciente (nó `pacientes únicos`), e não uma vez por falta.
- `gravar faltas` vira uma query só (tabela temporária + `UPDATE`/`INSERT` em conjunto): falta já gravada passa a ser atualizada (tipo de consulta, rótulo, profissional, horário) e nome/contato vazios são completados.
- Banco: rodar de novo `sql/criar_tabelas_bloqueio.sql` (coluna `IdRotulo` e as duas tabelas novas).

## 2026-10-07 — Usuários e perfis

### Adicionado

- **Perfis de acesso:** Leitor (só visualiza), Editor (libera, bloqueia, isenta e registra) e Admin (também gerencia usuários). A API confere o perfil em cada rota; o painel esconde o que o perfil não pode usar.
- **Tela Usuários** (`/usuarios`, só admin): criar com senha temporária exibida uma vez, editar nome e perfil, redefinir senha, desativar e reativar, e a lista de eventos.
- **Trocar senha** no menu, para qualquer usuário. Quem entra com senha temporária é obrigado a trocar antes de usar o painel. A senha nova precisa ter pelo menos 6 caracteres, um número e um caractere especial.
- Workflow **CNN Painel - Usuários** e tabelas `dbo.CtlCnnUsuario` e `dbo.CtlCnnUsuarioEvento` (`sql/criar_tabelas_usuarios.sql`).
- `npm run admin`: gera a senha aleatória e o `INSERT` do primeiro admin.
- 5 senhas erradas seguidas bloqueiam o login daquele usuário por 15 minutos.

### Alterado

- Os usuários saem da variável `DASHBOARD_USERS` e passam para o banco. Novas variáveis na Vercel: `SESSION_SECRET` e `N8N_USUARIOS_URL`. `DASHBOARD_USERS` e `npm run senha` deixam de existir.
- O login vira uma sessão assinada de 8 horas (`Authorization: Bearer`); a aba não guarda mais a senha.
- Liberar, bloquear e as ações de usuário conferem no banco se o usuário continua ativo e com o mesmo perfil: desativar ou rebaixar alguém vale na hora para as ações.

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
