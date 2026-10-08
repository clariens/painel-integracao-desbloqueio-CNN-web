// Primeiro admin do painel: `npm run admin` (ou `npm run admin -- <login> "<Nome>"`).
// Gera uma senha aleatória e imprime o INSERT para colar no SSMS. A senha aparece só aqui:
// guarde-a e troque no primeiro acesso (o painel obriga). Também serve para recuperar o acesso se
// todos os admins perderem a senha: troque o INSERT por UPDATE com o mesmo salt e hash.
import { LOGIN_PATTERN, gerarHash, senhaTemporaria } from "../lib/auth.js";

const login = process.argv[2] || "admin";
const nome = (process.argv[3] || "Administrador").replace(/'/g, "''");

if (!LOGIN_PATTERN.test(login)) {
  console.error("Uso: npm run admin -- <login> \"<Nome>\"   (login: letras, números, ponto, _ ou -; 2 a 50 caracteres)");
  process.exit(1);
}

const senha = senhaTemporaria();
const { salt, hash } = gerarHash(senha);

console.log(`
Senha temporária de ${login}: ${senha}
(não fica gravada em lugar nenhum; o painel pede a troca no primeiro acesso)

-- Cole no SSMS, banco INTEGRACAO:
INSERT INTO dbo.CtlCnnUsuario (Login, Nome, Perfil, Ativo, SenhaSalt, SenhaHash, TrocarSenha, CriadoPor)
VALUES (N'${login}', N'${nome}', N'ADMIN', 1, '${salt}', '${hash}', 1, N'carga manual');

INSERT INTO dbo.CtlCnnUsuarioEvento (Login, Evento, Detalhe, Por)
VALUES (N'${login}', N'CRIADO', N'Perfil ADMIN (carga manual)', N'carga manual');
`);
