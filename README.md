# Contract Register

Sistema de gestão de contratos (serviços, afretamentos TCP e bareboat, locações), com controle de versões, histórico de reajustes, alertas de prazo e login próprio para cada colaborador.

- **Site:** GitHub Pages (grátis) → `https://canelacool-bit.github.io/contract-register/`
- **Dados, login e arquivos PDF:** Supabase (plano gratuito)
- **Alertas por e-mail (90, 60, 30 e 15 dias):** GitHub Actions + Resend (grátis no volume de vocês)

Ninguém precisa ter conta no Claude nem no GitHub. Os colaboradores recebem um convite por e-mail, criam a senha e entram.

---

## Instalação (cerca de 1 hora, uma única vez)

### Parte 1: banco de dados no Supabase

1. Entre em <https://supabase.com>, crie a conta e clique em **New project**.
   - **Name:** `contract-register`
   - **Region:** *South America (São Paulo)*
   - Anote a senha do banco num lugar seguro (você quase nunca vai precisar dela).
2. Com o projeto pronto, abra **SQL Editor** (menu da esquerda) → **New query**.
   Copie todo o conteúdo do arquivo [`supabase/setup.sql`](supabase/setup.sql), cole e clique em **Run**. Deve aparecer *Success*.
3. **Feche o cadastro público:** *Authentication* → *Sign In / Providers* → **Email** → desligue **Allow new users to sign up** → *Save*.
   Assim só entra quem você convidar.
4. **Endereço do site:** *Authentication* → *URL Configuration*:
   - **Site URL:** `https://canelacool-bit.github.io/contract-register/`
   - Em **Redirect URLs**, adicione o mesmo endereço.
5. **Crie o seu usuário (administradora):** *Authentication* → *Users* → **Add user** → **Create new user**.
   Coloque seu e-mail e uma senha, marque **Auto Confirm User** e crie.
   A primeira pessoa cadastrada vira administradora automaticamente.
6. **Pegue as duas chaves:** *Project Settings* → *API* (ou *Data API / API Keys*):
   - **Project URL** (algo como `https://abcd1234.supabase.co`)
   - **anon public** key (uma sequência longa que começa com `eyJ...`)

> ⚠️ Nunca coloque a chave **service_role** no site. Ela só vai nos *Secrets* do GitHub (Parte 4).

### Parte 2: ligar o site ao banco

1. No GitHub, abra o arquivo [`config.js`](config.js) e clique no lápis (**Edit**).
2. Troque `https://YOUR-PROJECT.supabase.co` pelo seu **Project URL** e `YOUR-ANON-PUBLIC-KEY` pela chave **anon public**.
3. Clique em **Commit changes**.

A chave *anon* foi feita para ficar pública. Quem protege os dados é o login e as regras do banco criadas na Parte 1.

### Parte 3: colocar o site no ar

1. No repositório: **Settings** → **Pages**.
2. Em **Source**, escolha **Deploy from a branch**; em **Branch**, `main` e `/ (root)` → **Save**.
3. Em 1 ou 2 minutos o site estará em `https://canelacool-bit.github.io/contract-register/`.
4. Entre com o e-mail e a senha da Parte 1, passo 5. No topo deve aparecer **You are the administrator**.

### Parte 4: alertas por e-mail

Os alertas são enviados todo dia às 7h42 (Brasília): para os administradores, com todos os prazos, e para o **Responsible email** de cada contrato, só com os contratos dele.

1. Crie uma conta em <https://resend.com>.
2. Em **Domains**, adicione o domínio da empresa (ex.: `suaempresa.com`) e peça à TI para criar os registros DNS que o Resend mostrar.
   Sem isso, o Resend só consegue enviar e-mails para você mesma (serve para testar).
3. Em **API Keys**, crie uma chave e copie.
4. No GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Crie um por um:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | o Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | a chave **service_role** (Supabase → Project Settings → API) |
| `RESEND_API_KEY` | a chave do Resend |
| `ALERT_FROM` | quem envia, ex.: `Contract Register <alertas@suaempresa.com>` |
| `ALERT_TO` | e-mails dos administradores, separados por vírgula |

5. Teste: aba **Actions** → *Contract deadline alerts* → **Run workflow**. Se não houver prazo exatamente em 90, 60, 30 ou 15 dias, o registro mostra "0 alert(s)", o que é normal.

---

## Dia a dia

### Convidar colaboradores
1. Supabase → *Authentication* → *Users* → **Invite user** → e-mail da pessoa.
2. A pessoa recebe o convite, clica no link e cria a própria senha.
3. No sistema, clique em **Users** e escolha o papel dela:
   - **Administrator:** tudo, inclusive apagar contratos, gerenciar famílias de serviço e usuários
   - **Editor:** cadastra e edita contratos, registra reajustes, anexa PDFs, arquiva
   - **Viewer:** só consulta

Para tirar o acesso de alguém: Supabase → *Authentication* → *Users* → (⋯) → **Delete user**.

> O envio de e-mails embutido do Supabase gratuito é limitado a poucos e-mails por hora. Se for convidar muita gente de uma vez, configure o Resend como SMTP do Supabase (*Authentication* → *Emails* → *SMTP Settings*; host `smtp.resend.com`, porta `465`, usuário `resend`, senha = chave do Resend).

### Esqueci a senha
Na tela de login, **Forgot your password?** envia um link para criar uma nova.

### Backup
- Use **Export CSV** de vez em quando: gera uma planilha com todos os contratos e versões.
- O banco guarda automaticamente uma cópia de cada alteração de contrato na tabela `contract_history` (Supabase → *Table Editor*). Mesmo um contrato apagado pode ser recuperado de lá.

---

## Cuidados importantes

- **Supabase gratuito pausa projetos sem uso por 7 dias.** O alerta diário consulta o banco todo dia e mantém o projeto ativo. Se algum dia o site não carregar, entre no Supabase e clique em **Restore project**.
- **O GitHub desliga tarefas agendadas depois de 60 dias sem nenhuma alteração no repositório.** Ele avisa por e-mail antes; para religar, vá em *Actions* → *Contract deadline alerts* → **Enable workflow**.
- **A chave service_role dá acesso total ao banco.** Ela fica só nos *Secrets* do GitHub, nunca em `config.js` nem em outro arquivo.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | O sistema (telas) |
| `adapter.js` | Login, banco de dados, arquivos e usuários (Supabase) |
| `config.js` | Endereço e chave pública do seu Supabase |
| `supabase/setup.sql` | Criação do banco e das regras de segurança |
| `alerts/send-alerts.mjs` | Verificação diária de prazos e envio dos e-mails |
| `.github/workflows/alerts.yml` | Agenda do alerta diário (7h42, Brasília) |
