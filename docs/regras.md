# Regras de negócio

Voltar ao [índice](README.md). Todas as regras do sistema num lugar só, numeradas para facilitar a referência (por exemplo, "regra R12"). Cada regra diz **onde** está implementada. Para mudar uma regra, mude o código indicado e este documento juntos.

Fonte única dos parâmetros (prazos, ciclo, fuso): [`workflows/code/_regra.js`](../workflows/code/_regra.js), copiada para todos os workflows por `npm run inject`.

## 1. Faltas e ciclo

| # | Regra | Onde |
|---|---|---|
| R1 | **Falta** é todo agendamento do CNN com status `FALTOU`. Outros status (cancelado, finalizado, em espera…) não contam | `separar faltas` ([bloqueio-separar-faltas.js](../workflows/code/bloqueio-separar-faltas.js)) |
| R2 | O **ciclo** começa em **1º de outubro**. De outubro a dezembro, vale o 1/10 do ano corrente; de janeiro a setembro, o 1/10 do ano anterior. (Até 08/10/2026 o ciclo começava em 1º de agosto.) | `_regra.js` (`cicloInicio`), URL do nó `GET agenda do ciclo`, `js/formato.js` |
| R3 | Só contam as faltas **do início do ciclo até hoje**. Faltas de ciclos anteriores ficam no banco, mas não entram na contagem | `separar faltas`, consultas da Leitura |
| R4 | Cada falta é gravada **uma vez**, identificada pelo id do agendamento (`IdAgenda`). Ler a agenda de novo atualiza a falta, não duplica | `preparar insert SQL`, `UQ_CtlCnnFaltaPaciente_IdAgenda` |
| R5 | **Número da falta** (`NumeroFalta`) é a ordem da falta do paciente dentro do ciclo, por data (e por `IdAgenda` no empate): 1ª, 2ª, 3ª… É recalculado a cada gravação, então uma falta antiga que aparece depois entra na posição certa | `preparar insert SQL` (renumeração com `ROW_NUMBER`) |
| R6 | **Falta vigente** é a de maior número no ciclo (a mais recente). Sem falta no ciclo, vale a mais recente de antes | Leitura, `ids da consulta`, `consultar situação` |
| R7 | Falta desfeita no CNN (o status deixou de ser `FALTOU`) **não é apagada** automaticamente: continua contando até alguém apagar a linha no banco | Comportamento atual; ver [operacao.md](operacao.md#problemas-conhecidos) |
| R8 | A automação lê **todas as páginas** da agenda do ciclo (até 1000 páginas de 100 agendamentos). A paginação não pode ser desligada | Nó `GET agenda do ciclo` |

## 2. Prazo de liberação

| # | Regra | Onde |
|---|---|---|
| R9 | O prazo depende do número da falta vigente: **1ª = 60 dias, 2ª = 90 dias, 3ª ou mais = 180 dias** | `_regra.js` (`prazosDias`) |
| R10 | O prazo conta a partir da **data da falta vigente**. Fim do prazo = data da falta + dias do prazo | `somarDias`, `sqlDiasCase` |
| R11 | Uma falta nova **substitui** a vigente: o prazo recomeça da nova data, com o prazo do novo número | Consequência de R6 e R10 |
| R12 | **O prazo não decide o bloqueio.** Ele só diz **a partir de quando o paciente pode ser liberado**. Toda falta do ciclo bloqueia, com o prazo correndo ou já vencido | `montar info bloqueio`, `decidir` |

## 3. Bloqueio automático (01:00)

| # | Regra | Onde |
|---|---|---|
| R13 | Todo dia à **01:00** (horário de São Paulo), a automação bloqueia **todo paciente com falta no ciclo que esteja ativo no CNN** | Workflow de bloqueio |
| R14 | **Exceção:** quem foi **liberado ou teve a falta isenta pelo painel** por aquela mesma falta vigente **não é bloqueado de novo**. Só uma falta nova bloqueia outra vez | `ids da consulta` (filtro `LIBERADO` + `IdAgendaReferencia`) |
| R15 | Paciente que **já está inativo** no CNN não recebe comando de bloqueio: o bloqueio é só **registrado** no banco (auditoria e controle), com a anotação "Sem PATCH" | `enviar ao CNN?`, `montar registro` |
| R16 | Paciente já inativo **e** já registrado como bloqueado por aquela falta é ignorado (nada a fazer) | `montar info bloqueio` |
| R17 | Se o CNN não responder sobre o paciente (consulta falhou), ele é tratado como **ativo** e o bloqueio é enviado | `montar info bloqueio` |
| R18 | Os bloqueios são enviados **um por vez, com 3 segundos** entre eles | Nó `PATCH status paciente` |
| R19 | Paciente **reativado direto no CNN** (fora do painel) volta a ser bloqueado na madrugada seguinte, porque não houve liberação registrada | Consequência de R13 e R14 |
| R20 | Sem ninguém a bloquear, a execução termina com um resumo do motivo ("nada a bloquear") | `montar info bloqueio`, nó `nada a bloquear` |

## 4. Liberação (sempre manual)

| # | Regra | Onde |
|---|---|---|
| R21 | **A liberação é sempre feita por uma pessoa**, pelo painel. A liberação automática das 02:00 está **desativada** | Workflow Ações; [liberacao.md](liberacao.md) |
| R22 | Toda liberação exige **motivo** de **5 a 500 caracteres** | Painel, `lib/acao.js`, nó `Validar` |
| R23 | Pode liberar **antes do fim do prazo**. A liberação fica marcada como **antecipada** no histórico | `decidir` (`antecipada`) |
| R24 | Antes de liberar, o sistema consulta o CNN. Se o paciente **já está ativo**, não envia nada (resposta `JA_ATIVO`) e oferece **registrar a liberação** feita fora do painel | `decidir` |
| R25 | Se o paciente está ativo e **ainda não foi bloqueado** por aquela falta, a resposta é `NAO_BLOQUEADO`, e o painel oferece **isentar a falta** (R31) | `decidir` |
| R26 | Também é possível liberar paciente cuja falta vigente é de **ciclo anterior** (bloqueio que atravessou a virada do ciclo) | `decidir` |

## 5. Bloqueio pelo painel

| # | Regra | Onde |
|---|---|---|
| R27 | **Bloquear** no painel roda o fluxo de bloqueio só para aquele paciente: lê a agenda dele no ciclo, grava as faltas novas e bloqueia pela falta vigente | Workflow Ações |
| R28 | Só vale para paciente **com falta no ciclo atual** (sem falta no ciclo: 404) | `decidir` |
| R29 | Também exige **motivo** de 5 a 500 caracteres | Como R22 |
| R30 | Se o paciente **já está inativo** no CNN, não envia nada (resposta `JA_BLOQUEADO`) e oferece **registrar o bloqueio** feito fora do painel | `decidir` |

## 6. Registro de situação e isenção

| # | Regra | Onde |
|---|---|---|
| R31 | **Isentar a falta:** com o paciente ainda ativo e sem bloqueio registrado, o painel registra uma liberação **sem enviar nada ao CNN**. A automação deixa de bloquear por aquela falta (R14) | `decidir` (`isencao`), `montar registro` |
| R32 | **Registrar situação feita no CNN:** quando alguém liberou ou bloqueou direto no CNN, o painel registra a mesma situação no banco **sem enviar comando**. O histórico mostra "Só registro" | `apenasRegistrar` em `lib/acao.js` e no workflow Ações |
| R33 | O registro só é aceito se o CNN estiver **de fato** no estado pedido. Se não estiver, a ação segue normalmente, com o comando | `decidir` |

## 7. Situação de cada paciente (selos do painel)

| # | Regra | Onde |
|---|---|---|
| R34 | A situação vem da **tabela de controle**, mas **só vale se ela aponta para a falta vigente**. Sem registro para a falta vigente, o paciente está **Aguardando bloqueio** | `situacaoDe` ([leitura-montar-resposta.js](../workflows/code/leitura-montar-resposta.js)) |
| R35 | Controle `BLOQUEADO` + prazo correndo = **Bloqueado**; prazo vencido = **Apto a liberar** | Idem |
| R36 | Controle `LIBERADO` + prazo correndo = **Liberado antes do prazo**; prazo vencido = **Liberado** | Idem |
| R37 | A lista mostra os pacientes com falta no ciclo **e** os que continuam bloqueados por falta de ciclo anterior (marcados "ciclo anterior") | Consulta `pacientes` da Leitura |
| R38 | O **status ao vivo** no CNN (ativo ou inativo) só é consultado no **detalhe** do paciente | Consulta `paciente` da Leitura |

## 8. Rastreabilidade

| # | Regra | Onde |
|---|---|---|
| R39 | **Todo** comando enviado ao CNN (automático ou pelo painel), e todo registro sem comando, vira uma linha na **auditoria** (`CtlCnnAcaoPaciente`), com quem, quando, motivo, resposta do CNN e número da execução no n8n | `sqlRegistrarAcao` ([_sql.js](../workflows/code/_sql.js)) |
| R40 | A auditoria é gravada **sempre**, mesmo quando o CNN recusa. A tabela de **controle** só muda quando o CNN **aceita** | Idem |
| R41 | A auditoria **só recebe inclusões**: nenhum fluxo altera ou apaga uma linha | Desenho das tabelas e fluxos |
| R42 | A automação aparece no histórico como **"Automático (01:00)"**, com usuário `n8n` | `montar registro` do bloqueio |
| R43 | Se o comando deu certo no CNN mas a gravação da auditoria falhou, o painel mostra um **aviso** e a correção é manual, a partir da execução do n8n | `Montar resposta` das Ações |

## 9. Usuários e acesso

| # | Regra | Onde |
|---|---|---|
| R44 | Cada pessoa tem **login próprio**. O nome de quem fez aparece em todas as ações | `CtlCnnUsuario`, `lib/acao.js` |
| R45 | Perfis: **Leitor** só vê; **Editor** também libera, bloqueia, isenta e registra; **Admin** também gerencia usuários | `requireAuth` ([lib/auth.js](../lib/auth.js)) |
| R46 | A permissão é decidida pelo **servidor** (Vercel). A tela só esconde os botões; chamar a API direto sem permissão dá erro 403 | `requireAuth` |
| R47 | A sessão dura **8 horas** e fica só na aba do navegador. Fechar a aba encerra a sessão | `assinarSessao`, `js/session.js` |
| R48 | Antes de **qualquer ação que altera dados**, o sistema confere no banco se o usuário continua **ativo, com o mesmo perfil e a mesma versão de sessão**. Desativar alguém ou mudar seu perfil vale **na hora** para as ações | `revalidarSessao` ([lib/usuarios.js](../lib/usuarios.js)) |
| R49 | **Senha nova:** pelo menos **6 caracteres**, com pelo menos **um número** e **um caractere especial** | `validarSenha` ([lib/auth.js](../lib/auth.js)), `js/pagina.js` |
| R50 | Usuário novo e senha redefinida recebem uma **senha temporária**, mostrada **uma vez só** ao admin. No primeiro acesso, a troca é **obrigatória** | `api/usuarios`, `TrocarSenha` |
| R51 | **5 senhas erradas seguidas** travam o login daquele usuário por **15 minutos**. Redefinir a senha destrava | Workflow Usuários (`login-resultado`) |
| R52 | A mensagem de erro do login é **sempre a mesma** ("Usuário ou senha inválidos"), para não revelar quais logins existem | `api/sessao.js` |
| R53 | Usuários **não são excluídos**, só desativados: o nome continua no histórico | Tela e workflow Usuários |
| R54 | O admin **não pode** tirar o próprio perfil de admin nem se desativar. O banco **não deixa** desativar ou rebaixar o **último admin ativo** | `api/usuarios/[login].js`, workflow Usuários (`ULTIMO_ADMIN`) |
| R55 | A senha **nunca** é gravada nem trafega até o banco: só o resumo criptográfico (scrypt com salt) | `gerarHash`, `conferirSenha` |
| R56 | Toda mudança de usuário (criação, perfil, nome, desativação, senha) e toda senha errada viram um **evento** em `CtlCnnUsuarioEvento` | Workflow Usuários |

## 10. Dados pessoais (LGPD)

| # | Regra | Onde |
|---|---|---|
| R57 | O painel mostra **nome e ID** do paciente. O **CPF** aparece só no detalhe, **mascarado** (`***.456.789-**`), e a máscara é feita antes de sair do servidor | `mascararCpf` (Leitura) |
| R58 | **Telefone e e-mail** são guardados no banco, mas **não** são enviados ao painel | Consultas da Leitura |
| R59 | O **CSV** dos relatórios não tem CPF, telefone nem e-mail, e traz no máximo 5.000 linhas | `js/relatorios.js` |
| R60 | Os dados guardados no navegador ficam só na **aba** (`sessionStorage`) e somem ao fechá-la. Sair, novo login e sessão expirada apagam tudo | `js/session.js` |
| R61 | Saídas de execução do n8n com dados de pacientes **não** vão para o repositório (`*result*.json` no `.gitignore`) | `.gitignore` |

## 11. Desempenho do painel

| # | Regra | Onde |
|---|---|---|
| R62 | Ao entrar, o painel busca **todas as telas ao mesmo tempo** ("Preparando os dados…") | `prepararDados` ([js/pagina.js](../js/pagina.js)) |
| R63 | Cada tela guarda o dado na aba por um prazo: Pacientes 2 min, detalhe 1 min, Relatórios 10 min, Histórico 2 min, Configuração 30 min, Usuários 2 min. Dentro do prazo, trocar de tela não chama o servidor | `CACHE` ([js/session.js](../js/session.js)) |
| R64 | Dado vencido (até 12 h) **aparece na hora** e é atualizado em segundo plano | `comCache` (`aoAtualizar`) |
| R65 | Depois de uma ação (liberar, bloquear, isentar, registrar), o dado afetado é apagado da aba e buscado de novo | `js/pacientes.js` |

## 12. Nomes e cadastros

| # | Regra | Onde |
|---|---|---|
| R66 | Os nomes de **tipo de consulta, profissional, rótulo, local e especialidade** vêm das listas do CNN e são atualizados a cada execução das 01:00 (`CtlCnnCadastro`) | Nós de cadastro do bloqueio |
| R67 | O **profissional** da agenda é identificado pelo `idpessoa` da lista de executores (não pelo `id` do executor) | `preparar insert SQL` |
| R68 | O "o que o paciente ia fazer" é o **procedimento** do agendamento. Quando a clínica não preenche procedimentos, vale o **tipo de consulta** | `js/pacientes.js` (`procedimentoHtml`) |
| R69 | Sem nome cadastrado ainda, os relatórios mostram **"Código …"**, e a próxima execução completa | Consulta `faltas` da Leitura |
