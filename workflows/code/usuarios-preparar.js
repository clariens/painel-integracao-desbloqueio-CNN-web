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

const loginValido = () => LOGIN.test(login);
const senhaValida = () => /^[0-9a-f]{32}$/.test(salt) && /^[0-9a-f]{128}$/.test(hash);
const nomeValido = () => nome !== null && nome.length >= 2 && nome.length <= 100;

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
WHERE Login = @login;`);
}

if (action === 'sessao') {
  return ok(`${cabecalho}
SELECT TOP (1) Login, Nome, Perfil, Ativo, VersaoSessao
FROM dbo.CtlCnnUsuario
WHERE Login = @login;`);
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

  return ok(escrita(`IF EXISTS (SELECT 1 FROM dbo.CtlCnnUsuario WITH (UPDLOCK, HOLDLOCK) WHERE Login = @login)
BEGIN
    SELECT N'LOGIN_EXISTE' AS Resultado;
END
ELSE
BEGIN
    INSERT INTO dbo.CtlCnnUsuario (Login, Nome, Perfil, Ativo, SenhaSalt, SenhaHash, TrocarSenha, CriadoPor)
    VALUES (@login, ${sqlS(nome, 100)}, ${sqlS(perfil, 10)}, 1, '${salt}', '${hash}', 1, ${sqlS(por, 50)});

    INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
    VALUES (@login, N'CRIADO', ${sqlS(`Perfil ${perfil}`, 500)}, ${sqlS(por, 50)});

    SELECT N'OK' AS Resultado;
END;`));
}

if (action === 'alterar') {
  if (nome !== null && !nomeValido()) return erro(400, 'Informe o nome (2 a 100 caracteres).');
  if (perfil !== null && !PERFIS.includes(perfil)) return erro(400, 'Perfil inválido.');
  if (nome === null && perfil === null && ativo === null) return erro(400, 'Nada para alterar.');
  if (!LOGIN.test(por)) return erro(400, 'Usuário responsável inválido.');

  // Mudar perfil ou desativar sobe VersaoSessao: a sessão aberta da pessoa deixa de valer nas ações.
  return ok(escrita(`DECLARE @nome NVARCHAR(100) = ${sqlS(nome, 100)};
DECLARE @perfil NVARCHAR(10) = ${sqlS(perfil, 10)};
DECLARE @ativo BIT = ${sqlBit(ativo)};
DECLARE @por NVARCHAR(50) = ${sqlS(por, 50)};
DECLARE @nomeAtual NVARCHAR(100), @perfilAtual NVARCHAR(10), @ativoAtual BIT;

SELECT @nomeAtual = Nome, @perfilAtual = Perfil, @ativoAtual = Ativo
FROM dbo.CtlCnnUsuario WITH (UPDLOCK, HOLDLOCK)
WHERE Login = @login;

DECLARE @perfilNovo NVARCHAR(10) = COALESCE(@perfil, @perfilAtual);
DECLARE @ativoNovo BIT = COALESCE(@ativo, @ativoAtual);

IF @perfilAtual IS NULL
BEGIN
    SELECT N'NAO_ENCONTRADO' AS Resultado;
END
ELSE IF @perfilAtual = N'ADMIN' AND @ativoAtual = 1 AND (@perfilNovo <> N'ADMIN' OR @ativoNovo = 0)
    AND (SELECT COUNT(*) FROM dbo.CtlCnnUsuario WITH (UPDLOCK, HOLDLOCK) WHERE Perfil = N'ADMIN' AND Ativo = 1) <= 1
BEGIN
    SELECT N'ULTIMO_ADMIN' AS Resultado;
END
ELSE
BEGIN
    UPDATE dbo.CtlCnnUsuario
    SET
        Nome = COALESCE(@nome, Nome),
        Perfil = @perfilNovo,
        Ativo = @ativoNovo,
        TentativasFalhas = CASE WHEN @ativoNovo = 1 AND @ativoAtual = 0 THEN 0 ELSE TentativasFalhas END,
        BloqueadoAte = CASE WHEN @ativoNovo = 1 AND @ativoAtual = 0 THEN NULL ELSE BloqueadoAte END,
        VersaoSessao = VersaoSessao + CASE WHEN @perfilNovo <> @perfilAtual OR @ativoNovo <> @ativoAtual THEN 1 ELSE 0 END,
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
