// Nó "Preparar" (workflow CNN Painel - Usuários). Lê body.action, valida os campos e monta o SQL.
// A senha em texto nunca chega aqui: a Vercel manda salt e hash (scrypt) já calculados.
// Escritas devolvem uma linha { Resultado } (OK, LOGIN_EXISTE, NAO_ENCONTRADO, ULTIMO_ADMIN).
const unwrap = (valor) => {
  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor);
    } catch (erro) {
      return {};
    }
  }

  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
};

const item = unwrap($input.first().json);
const body = { ...item, ...unwrap(item.body) };
const action = String(body.action || '').trim();

const erro = (statusCode, mensagem) => [{
  json: { action: 'error', statusCode, response: { error: mensagem } }
}];

const LOGIN = /^[A-Za-z0-9._-]{2,50}$/;
const PERFIS = ['LEITOR', 'EDITOR', 'ADMIN'];
const login = String(body.login || '').trim();
const por = String(body.por || '').trim();
const salt = String(body.salt || '');
const hash = String(body.hash || '');
const nome = body.nome === undefined || body.nome === null ? null : String(body.nome).replace(/\s+/g, ' ').trim();
const perfil = body.perfil === undefined || body.perfil === null ? null : String(body.perfil).toUpperCase();
const ativo = typeof body.ativo === 'boolean' ? body.ativo : null;

// Unidades do usuário (LEITOR/EDITOR): lista de IdUnidade. null = não mexer (alterar); o ADMIN acessa todas e não usa.
const unidades = Array.isArray(body.unidades)
  ? [...new Set(body.unidades.map(Number))]
  : null;
const unidadesValidas = () => unidades !== null && unidades.every((id) => Number.isSafeInteger(id) && id > 0 && id <= 32767);

const loginValido = () => LOGIN.test(login);
const senhaValida = () => /^[0-9a-f]{32}$/.test(salt) && /^[0-9a-f]{128}$/.test(hash);
const nomeValido = () => nome !== null && nome.length >= 2 && nome.length <= 100;

// Unidades que o usuário @login acessa: o ADMIN, todas as ativas; os outros, as ligadas a ele.
const unidadesDoLogin = `
SELECT N'unidade' AS _secao, u.IdUnidade, u.Codigo, u.Nome
FROM dbo.CtlCnnUnidade u
WHERE u.Ativa = 1
  AND (
        EXISTS (SELECT 1 FROM dbo.CtlCnnUsuario x WHERE x.Login = @login AND x.Perfil = N'ADMIN')
     OR EXISTS (
            SELECT 1
            FROM dbo.CtlCnnUsuarioUnidade uu
            INNER JOIN dbo.CtlCnnUsuario x ON x.IdUsuario = uu.IdUsuario
            WHERE x.Login = @login AND uu.IdUnidade = u.IdUnidade
        )
  )
ORDER BY u.Nome;`;

// @novas = unidades pedidas. Confere se todas existem e estão ativas (senão UNIDADE_INVALIDA).
const declararNovas = (lista) => `DECLARE @novas TABLE (IdUnidade SMALLINT PRIMARY KEY);
${lista.length ? `INSERT INTO @novas (IdUnidade) VALUES ${lista.map((id) => `(${sqlN(id)})`).join(', ')};` : ''}
DECLARE @unidadesInvalidas INT = (
    SELECT COUNT(*) FROM @novas n
    WHERE NOT EXISTS (SELECT 1 FROM dbo.CtlCnnUnidade u WHERE u.IdUnidade = n.IdUnidade AND u.Ativa = 1)
);`;

// Códigos das unidades de um usuário, para o detalhe do evento ("ZARNS_SALVADOR, ZARNS_POUSO_ALEGRE").
const codigosDe = (idUsuario) => `ISNULL(STUFF((
        SELECT N', ' + u.Codigo
        FROM dbo.CtlCnnUsuarioUnidade uu
        INNER JOIN dbo.CtlCnnUnidade u ON u.IdUnidade = uu.IdUnidade
        WHERE uu.IdUsuario = ${idUsuario}
        ORDER BY u.Codigo
        FOR XML PATH(''), TYPE
    ).value('.', 'nvarchar(max)'), 1, 2, N''), N'(nenhuma)')`;

const cabecalho = `USE INTEGRACAO;
SET NOCOUNT ON;
DECLARE @login NVARCHAR(50) = ${sqlS(login, 50)};`;

const escrita = (corpo) => `${cabecalho}
SET XACT_ABORT ON;
BEGIN TRANSACTION;
${corpo}
COMMIT TRANSACTION;`;

const ok = (query, extra = {}) => [{ json: { action, login, query, ...extra } }];

if (action === 'listar') {
  return ok(`USE INTEGRACAO;
SET NOCOUNT ON;
SELECT
    N'usuario' AS _secao, Login, Nome, Perfil, Ativo, TrocarSenha, BloqueadoAte,
    UltimoAcessoEm, CriadoEm, CriadoPor, AlteradoEm, AlteradoPor
FROM dbo.CtlCnnUsuario;

SELECT N'vinculo' AS _secao, x.Login, uu.IdUnidade
FROM dbo.CtlCnnUsuarioUnidade uu
INNER JOIN dbo.CtlCnnUsuario x ON x.IdUsuario = uu.IdUsuario;

SELECT N'unidade' AS _secao, IdUnidade, Codigo, Nome, Ativa
FROM dbo.CtlCnnUnidade
ORDER BY Nome;

SELECT TOP (100)
    N'evento' AS _secao, Id, Login, Evento, Detalhe, Por, CriadoEm
FROM dbo.CtlCnnUsuarioEvento
ORDER BY CriadoEm DESC, Id DESC;`);
}

if (!loginValido()) {
  return erro(400, 'Login inválido: use letras, números, ponto, _ ou - (2 a 50 caracteres).');
}

if (action === 'login-buscar') {
  return ok(`${cabecalho}
SELECT TOP (1)
    Login, Nome, Perfil, Ativo, SenhaSalt, SenhaHash, TrocarSenha, VersaoSessao, BloqueadoAte,
    CASE WHEN BloqueadoAte > SYSUTCDATETIME() THEN 1 ELSE 0 END AS Bloqueado
FROM dbo.CtlCnnUsuario
WHERE Login = @login;
${unidadesDoLogin}`);
}

if (action === 'sessao') {
  return ok(`${cabecalho}
SELECT TOP (1) Login, Nome, Perfil, Ativo, VersaoSessao
FROM dbo.CtlCnnUsuario
WHERE Login = @login;
${unidadesDoLogin}`);
}

if (action === 'login-resultado') {
  if (body.sucesso === true) {
    return ok(`${cabecalho}
UPDATE dbo.CtlCnnUsuario
SET TentativasFalhas = 0, BloqueadoAte = NULL, UltimoAcessoEm = SYSUTCDATETIME()
WHERE Login = @login;
SELECT CAST(NULL AS DATETIME2(0)) AS BloqueadoAte;`);
  }

  // 5 erros seguidos bloqueiam por 15 minutos; a contagem recomeça depois do bloqueio.
  return ok(escrita(`DECLARE @r TABLE (BloqueadoAte DATETIME2(0) NULL, Bloqueou BIT NOT NULL);

UPDATE dbo.CtlCnnUsuario
SET
    TentativasFalhas = CASE WHEN TentativasFalhas + 1 >= 5 THEN 0 ELSE TentativasFalhas + 1 END,
    BloqueadoAte = CASE WHEN TentativasFalhas + 1 >= 5 THEN DATEADD(MINUTE, 15, SYSUTCDATETIME()) ELSE BloqueadoAte END
OUTPUT
    inserted.BloqueadoAte,
    CASE WHEN deleted.TentativasFalhas + 1 >= 5 THEN 1 ELSE 0 END
INTO @r
WHERE Login = @login;

INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
SELECT
    @login,
    CASE WHEN Bloqueou = 1 THEN N'LOGIN_BLOQUEADO' ELSE N'LOGIN_FALHA' END,
    CASE WHEN Bloqueou = 1 THEN N'5 senhas erradas seguidas: bloqueado por 15 minutos' ELSE N'Senha errada' END,
    NULL
FROM @r;

SELECT CASE WHEN Bloqueou = 1 THEN BloqueadoAte END AS BloqueadoAte FROM @r;`));
}

if (action === 'criar') {
  if (!nomeValido()) return erro(400, 'Informe o nome (2 a 100 caracteres).');
  if (!PERFIS.includes(perfil)) return erro(400, 'Perfil inválido.');
  if (!senhaValida()) return erro(400, 'Senha inválida.');
  if (!LOGIN.test(por)) return erro(400, 'Usuário responsável inválido.');
  const admin = perfil === 'ADMIN';
  if (!admin && (!unidadesValidas() || !unidades.length)) return erro(400, 'Escolha ao menos uma unidade.');

  return ok(escrita(`${declararNovas(admin ? [] : unidades)}

IF EXISTS (SELECT 1 FROM dbo.CtlCnnUsuario WITH (UPDLOCK, HOLDLOCK) WHERE Login = @login)
BEGIN
    SELECT N'LOGIN_EXISTE' AS Resultado;
END
ELSE IF @unidadesInvalidas > 0
BEGIN
    SELECT N'UNIDADE_INVALIDA' AS Resultado;
END
ELSE
BEGIN
    INSERT INTO dbo.CtlCnnUsuario (Login, Nome, Perfil, Ativo, SenhaSalt, SenhaHash, TrocarSenha, CriadoPor)
    VALUES (@login, ${sqlS(nome, 100)}, ${sqlS(perfil, 10)}, 1, '${salt}', '${hash}', 1, ${sqlS(por, 50)});

    DECLARE @idUsuario INT = CONVERT(INT, SCOPE_IDENTITY());
    INSERT INTO dbo.CtlCnnUsuarioUnidade (IdUsuario, IdUnidade)
    SELECT @idUsuario, IdUnidade FROM @novas;

    INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
    VALUES (@login, N'CRIADO', LEFT(${sqlS(`Perfil ${perfil}`, 100)}${admin ? '' : ` + N' · unidades: ' + ${codigosDe('@idUsuario')}`}, 500), ${sqlS(por, 50)});

    SELECT N'OK' AS Resultado;
END;`));
}

if (action === 'alterar') {
  if (nome !== null && !nomeValido()) return erro(400, 'Informe o nome (2 a 100 caracteres).');
  if (perfil !== null && !PERFIS.includes(perfil)) return erro(400, 'Perfil inválido.');
  if (unidades !== null && !unidadesValidas()) return erro(400, 'Unidades inválidas.');
  if (nome === null && perfil === null && ativo === null && unidades === null) return erro(400, 'Nada para alterar.');
  if (!LOGIN.test(por)) return erro(400, 'Usuário responsável inválido.');
  const trocarUnidades = unidades !== null;

  // Mudar perfil, unidades ou desativar sobe VersaoSessao: a sessão aberta da pessoa deixa de valer nas ações.
  // Quem não é ADMIN precisa ficar com ao menos uma unidade (SEM_UNIDADE). Virar ADMIN não apaga as unidades:
  // elas só deixam de importar (o admin acessa todas).
  return ok(escrita(`DECLARE @nome NVARCHAR(100) = ${sqlS(nome, 100)};
DECLARE @perfil NVARCHAR(10) = ${sqlS(perfil, 10)};
DECLARE @ativo BIT = ${sqlBit(ativo)};
DECLARE @por NVARCHAR(50) = ${sqlS(por, 50)};
DECLARE @trocarUnidades BIT = ${sqlBit(trocarUnidades)};
DECLARE @idUsuario INT, @nomeAtual NVARCHAR(100), @perfilAtual NVARCHAR(10), @ativoAtual BIT;
${declararNovas(trocarUnidades ? unidades : [])}

SELECT @idUsuario = IdUsuario, @nomeAtual = Nome, @perfilAtual = Perfil, @ativoAtual = Ativo
FROM dbo.CtlCnnUsuario WITH (UPDLOCK, HOLDLOCK)
WHERE Login = @login;

DECLARE @perfilNovo NVARCHAR(10) = COALESCE(@perfil, @perfilAtual);
DECLARE @ativoNovo BIT = COALESCE(@ativo, @ativoAtual);
DECLARE @mudouUnidades BIT = CASE WHEN @trocarUnidades = 1 AND (
        EXISTS (SELECT IdUnidade FROM @novas EXCEPT SELECT IdUnidade FROM dbo.CtlCnnUsuarioUnidade WHERE IdUsuario = @idUsuario)
     OR EXISTS (SELECT IdUnidade FROM dbo.CtlCnnUsuarioUnidade WHERE IdUsuario = @idUsuario EXCEPT SELECT IdUnidade FROM @novas)
    ) THEN 1 ELSE 0 END;
DECLARE @unidadesFinais INT = CASE WHEN @trocarUnidades = 1
    THEN (SELECT COUNT(*) FROM @novas)
    ELSE (SELECT COUNT(*) FROM dbo.CtlCnnUsuarioUnidade WHERE IdUsuario = @idUsuario) END;

IF @perfilAtual IS NULL
BEGIN
    SELECT N'NAO_ENCONTRADO' AS Resultado;
END
ELSE IF @perfilAtual = N'ADMIN' AND @ativoAtual = 1 AND (@perfilNovo <> N'ADMIN' OR @ativoNovo = 0)
    AND (SELECT COUNT(*) FROM dbo.CtlCnnUsuario WITH (UPDLOCK, HOLDLOCK) WHERE Perfil = N'ADMIN' AND Ativo = 1) <= 1
BEGIN
    SELECT N'ULTIMO_ADMIN' AS Resultado;
END
ELSE IF @unidadesInvalidas > 0
BEGIN
    SELECT N'UNIDADE_INVALIDA' AS Resultado;
END
ELSE IF @perfilNovo <> N'ADMIN' AND @unidadesFinais = 0
BEGIN
    SELECT N'SEM_UNIDADE' AS Resultado;
END
ELSE
BEGIN
    IF @mudouUnidades = 1
    BEGIN
        DELETE FROM dbo.CtlCnnUsuarioUnidade WHERE IdUsuario = @idUsuario;
        INSERT INTO dbo.CtlCnnUsuarioUnidade (IdUsuario, IdUnidade)
        SELECT @idUsuario, IdUnidade FROM @novas;

        INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
        VALUES (@login, N'UNIDADES_ALTERADAS', LEFT(${codigosDe('@idUsuario')}, 500), @por);
    END;

    UPDATE dbo.CtlCnnUsuario
    SET
        Nome = COALESCE(@nome, Nome),
        Perfil = @perfilNovo,
        Ativo = @ativoNovo,
        TentativasFalhas = CASE WHEN @ativoNovo = 1 AND @ativoAtual = 0 THEN 0 ELSE TentativasFalhas END,
        BloqueadoAte = CASE WHEN @ativoNovo = 1 AND @ativoAtual = 0 THEN NULL ELSE BloqueadoAte END,
        VersaoSessao = VersaoSessao + CASE WHEN @perfilNovo <> @perfilAtual OR @ativoNovo <> @ativoAtual OR @mudouUnidades = 1 THEN 1 ELSE 0 END,
        AlteradoEm = SYSUTCDATETIME(),
        AlteradoPor = @por
    WHERE Login = @login;

    IF @nome IS NOT NULL AND @nome <> @nomeAtual
        INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
        VALUES (@login, N'NOME_ALTERADO', LEFT(@nomeAtual + N' → ' + @nome, 500), @por);

    IF @perfilNovo <> @perfilAtual
        INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
        VALUES (@login, N'PERFIL_ALTERADO', @perfilAtual + N' → ' + @perfilNovo, @por);

    IF @ativoNovo <> @ativoAtual
        INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
        VALUES (@login, CASE WHEN @ativoNovo = 1 THEN N'REATIVADO' ELSE N'DESATIVADO' END, NULL, @por);

    SELECT N'OK' AS Resultado;
END;`));
}

if (action === 'redefinir-senha' || action === 'trocar-senha') {
  if (!senhaValida()) return erro(400, 'Senha inválida.');
  const redefinir = action === 'redefinir-senha';
  if (redefinir && !LOGIN.test(por)) return erro(400, 'Usuário responsável inválido.');
  const responsavel = redefinir ? por : login;

  // Redefinir (admin) gera senha temporária: a pessoa troca no próximo acesso. Trocar (a própria) encerra isso.
  return ok(escrita(`DECLARE @r TABLE (VersaoSessao INT NOT NULL);

UPDATE dbo.CtlCnnUsuario
SET
    SenhaSalt = '${salt}',
    SenhaHash = '${hash}',
    TrocarSenha = ${redefinir ? 1 : 0},
    VersaoSessao = VersaoSessao + 1,
    TentativasFalhas = 0,
    BloqueadoAte = NULL,
    AlteradoEm = SYSUTCDATETIME(),
    AlteradoPor = ${sqlS(responsavel, 50)}
OUTPUT inserted.VersaoSessao INTO @r
WHERE Login = @login${redefinir ? '' : ' AND Ativo = 1'};

IF NOT EXISTS (SELECT 1 FROM @r)
BEGIN
    SELECT N'NAO_ENCONTRADO' AS Resultado, CAST(NULL AS INT) AS VersaoSessao;
END
ELSE
BEGIN
    INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
    VALUES (@login, ${sqlS(redefinir ? 'SENHA_REDEFINIDA' : 'SENHA_TROCADA', 30)}, NULL, ${sqlS(responsavel, 50)});

    SELECT N'OK' AS Resultado, VersaoSessao FROM @r;
END;`));
}

return erro(400, `Ação desconhecida: ${action || '(vazia)'}.`);
