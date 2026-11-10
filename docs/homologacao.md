# Homologação (testes de entrega)

Voltar ao [índice](README.md). Roteiro para conferir o sistema antes de entregá-lo como pronto. Cada linha é um teste: faça o que está em **Teste**, compare com **Resultado esperado** e marque a coluna da unidade.

| Campo | Preencher |
|---|---|
| Data dos testes | |
| Responsável | |
| Versão (commit) | |
| Paciente de teste de cada unidade (só o id) | Salvador: · Pouso Alegre: · José Gomes da Rocha: |

**Colunas das unidades:** **SSA** = Clínica Escola Zarns Salvador · **PA** = Clínica Escola Zarns Pouso Alegre · **JGR** = Centro Ambulatório José Gomes da Rocha. Onde aparece "—", o teste é um só para o sistema todo.

## Antes de começar

- Combine com cada clínica **um paciente de teste**. Bloquear e liberar mudam o paciente **de verdade** no CNN.
- Tenha três usuários de teste: um **Admin**, um **Editor com uma unidade** e um **Leitor com duas unidades**.
- **Não copie** dados de paciente (nome, CPF, telefone) neste documento, em e-mail ou em chat. Anote só o id.
- Os testes da parte 6 dependem da madrugada: confira na manhã seguinte.

## 1. Configuração

| # | Teste | Resultado esperado | SSA | PA | JGR |
|---|---|---|---|---|---|
| 1.1 | `SELECT IdUnidade, Codigo, Nome, Ativa FROM dbo.CtlCnnUnidade` no SSMS | As três unidades, com `Ativa = 1` | ☐ | ☐ | ☐ |
| 1.2 | n8n, aba **Variables** | Existe `CNN_CID_<código>` de cada unidade, com o nome igual ao `Codigo` do banco | ☐ | ☐ | ☐ |
| 1.3 | Teste das Variables ([abaixo](#teste-das-variables)) | `soHex32: true` e nenhum caractere estranho | ☐ | ☐ | ☐ |
| 1.4 | n8n, lista de workflows | Bloqueio, Bloqueio por unidade, Liberação, Leitura, Ações, Usuários e Solicitações ativos e na versão do repositório | — | — | — |
| 1.5 | Nó `bloquear unidade` do Bloqueio | Aponta para o workflow "Bloqueio por unidade" | — | — | — |
| 1.6 | Webhooks dos fluxos | Sem dados fixados (pinData) | — | — | — |

## 2. Login e perfis

| # | Teste | Resultado esperado | SSA | PA | JGR |
|---|---|---|---|---|---|
| 2.1 | Entrar como **Admin** | Aparece a escolha com as três unidades, antes de carregar os dados | — | — | — |
| 2.2 | Admin troca de unidade pelo topo da tela | O chip e os dados mudam para a unidade escolhida | ☐ | ☐ | ☐ |
| 2.3 | Entrar com o **Editor de uma unidade** | Entra direto, sem a escolha | — | — | — |
| 2.4 | Entrar com o **Leitor de duas unidades** | Escolhe entre as duas; a terceira não aparece | — | — | — |
| 2.5 | Entrar com um usuário sem unidade | "Seu usuário não tem nenhuma unidade liberada" | — | — | — |
| 2.6 | Errar a senha 5 vezes | O login fica travado | — | — | — |
| 2.7 | Entrar com senha temporária | Pede a troca de senha antes de tudo | — | — | — |
| 2.8 | Sair | Volta para o login; voltar no navegador não mostra dados | — | — | — |

## 3. Separação entre unidades

| # | Teste | Resultado esperado | SSA | PA | JGR |
|---|---|---|---|---|---|
| 3.1 | Abrir Pacientes, Dashboard, Solicitações, Relatórios, Histórico e Configuração | Tudo é da unidade escolhida | ☐ | ☐ | ☐ |
| 3.2 | Procurar o paciente de teste de uma unidade estando em outra | Não aparece | ☐ | ☐ | ☐ |
| 3.3 | Contador de Solicitações no menu | Conta só a unidade atual | ☐ | ☐ | ☐ |
| 3.4 | Trocar para uma unidade já aberta na aba | Abre na hora (cache), com os dados dela | — | — | — |
| 3.5 | Tirar uma unidade do Editor (tela Usuários) e ele tentar bloquear nela | A ação é recusada | — | — | — |

## 4. Ações no paciente

Com o paciente de teste, nesta ordem.

| # | Teste | Resultado esperado | SSA | PA | JGR |
|---|---|---|---|---|---|
| 4.1 | Abrir o detalhe do paciente | Abre com faltas e situação, sem erro. "Paciente não encontrado" aqui é falha: anote o id e a hora | ☐ | ☐ | ☐ |
| 4.2 | Editor: **Bloquear** (com motivo) | Fica inativo no CNN; a ação aparece no Histórico | ☐ | ☐ | ☐ |
| 4.3 | Bloquear de novo | Avisa que já está bloqueado e oferece só registrar | ☐ | ☐ | ☐ |
| 4.4 | Editor: **Liberar** sem solicitação, com o prazo correndo | Recusado: exige solicitação aprovada | ☐ | ☐ | ☐ |
| 4.5 | Leitor no mesmo paciente | Não vê Bloquear nem Liberar | ☐ | ☐ | ☐ |

## 5. Solicitações de desbloqueio

| # | Teste | Resultado esperado | SSA | PA | JGR |
|---|---|---|---|---|---|
| 5.1 | Leitor: **Solicitar desbloqueio** com motivo | Aparece como Pendente | ☐ | ☐ | ☐ |
| 5.2 | Pedir de novo para o mesmo paciente | Recusado: já existe uma aberta | ☐ | ☐ | ☐ |
| 5.3 | Admin: **Recusar** com motivo | Fica Recusada; o motivo aparece | ☐ | ☐ | ☐ |
| 5.4 | Nova solicitação; Admin **Aprova**; Editor **Libera** | Ativo no CNN; solicitação Liberada | ☐ | ☐ | ☐ |
| 5.5 | Bloquear de novo; nova solicitação; Admin **Aprovar e liberar** | Ativo no CNN direto | ☐ | ☐ | ☐ |
| 5.6 | Nova solicitação; quem pediu **Cancela** | Fica Cancelada | ☐ | ☐ | ☐ |
| 5.7 | Paciente "Aguardando bloqueio": solicitação aprovada | A falta fica isenta; ele não é bloqueado na madrugada | ☐ | ☐ | ☐ |

## 6. Automações da madrugada

Conferir na manhã seguinte, no n8n (Executions) e no painel.

| # | Teste | Resultado esperado | SSA | PA | JGR |
|---|---|---|---|---|---|
| 6.1 | Execução das **01:00** (Bloqueio) | Um item por unidade no `bloquear unidade`; cada subfluxo terminou sem erro | ☐ | ☐ | ☐ |
| 6.2 | Faltas do dia anterior | Entraram no banco com o `IdUnidade` certo e aparecem em Pacientes | ☐ | ☐ | ☐ |
| 6.3 | Quem tem falta com prazo correndo | Bloqueado. Quem já cumpriu o prazo, não | ☐ | ☐ | ☐ |
| 6.4 | Execução das **02:00** (Liberação) | Sem erro; quem cumpriu o prazo foi liberado | ☐ | ☐ | ☐ |
| 6.5 | Tela **Configuração** | Mostra o último bloqueio e a última liberação da unidade | ☐ | ☐ | ☐ |
| 6.6 | *(opcional)* Renomear de propósito uma Variable e rodar o Bloqueio pelo editor. **Volte o nome depois** | Só aquela unidade falha; as outras seguem | — | — | — |

## 7. Usuários (Admin)

| # | Teste | Resultado esperado | OK |
|---|---|---|---|
| 7.1 | Criar usuário com perfil e unidades | Aparece na lista, com as unidades; recebe senha temporária | ☐ |
| 7.2 | Criar Leitor ou Editor sem unidade | O formulário não deixa | ☐ |
| 7.3 | Mudar as unidades de alguém | Evento "Unidades alteradas" | ☐ |
| 7.4 | Desativar um usuário | O login dele é recusado | ☐ |
| 7.5 | Redefinir a senha | Recebe senha temporária e troca no próximo login | ☐ |

## 8. Geral

| # | Teste | Resultado esperado | OK |
|---|---|---|---|
| 8.1 | Abrir no celular | Menu, chip da unidade e tabelas funcionam, sem rolar para o lado | ☐ |
| 8.2 | Sessão aberta por mais de 8 horas | Pede login de novo | ☐ |
| 8.3 | Documentação | Os Word de `docs\word` estão atualizados e foram passados para quem usa | ☐ |

## Teste das Variables

Confere se o CID de cada unidade está limpo, **sem mostrar o valor**. Um caractere invisível (por exemplo, um espaço especial no fim, comum ao copiar de página ou de WhatsApp) faz o CNN não reconhecer a clínica e responder "Paciente não encontrado", mesmo com o paciente existindo.

1. Em qualquer workflow, crie um nó **Code** solto (sem ligar em nada) e cole o código abaixo.
2. Clique em **Execute step**.
3. Cada unidade deve sair com `existe: true`, `tamanho: 32`, `soHex32: true` e `caracteresEstranhos` vazio.
4. Apague o nó depois.

```js
const codigos = ['ZARNS_SALVADOR', 'ZARNS_POUSO_ALEGRE', 'JOSE_GOMES_DA_ROCHA'];
return codigos.map((codigo) => {
  const nome = `CNN_CID_${codigo}`;
  let valor;
  try { valor = $vars[nome]; } catch (erro) { valor = undefined; }
  const texto = valor == null ? '' : String(valor);
  return { json: {
    variavel: nome,
    existe: valor != null,
    tamanho: texto.length,
    soHex32: /^[0-9a-f]{32}$/i.test(texto),
    caracteresEstranhos: [...texto]
      .filter((c) => !/[0-9a-zA-Z]/.test(c))
      .map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')),
  } };
});
```

Se aparecer algum caractere estranho, apague o valor da Variable e **digite** o CID de novo (ou cole a partir de um bloco de notas simples).

## Aceite

| | Nome | Data | Assinatura |
|---|---|---|---|
| Testou | | | |
| Aprovou | | | |

Pendências encontradas:

| # | Teste | O que aconteceu | Responsável | Resolvido em |
|---|---|---|---|---|
| | | | | |
