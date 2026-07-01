# NG.cash · Dashboard de Demandas (Redes Sociais & Lojas)

Dashboard estático e interativo que lê **em tempo real** os comentários classificados na Buzzmonitor, exportados para o Google Sheets. Pronto para publicar no **GitHub Pages** e compartilhar por URL.

---

## 📊 O que o dashboard mostra

- **KPIs**: total de comentários no filtro, % com demanda identificada, % sentimento negativo, canais ativos.
- **Top demandas** (geral) — barras interativas.
- **Sentimento** e **Volume por canal** — rosca.
- **Volume ao longo do tempo** — linha.
- **Top 10 demandas por canal** — um gráfico dedicado para Play Store, Instagram, TikTok e App Store.
- **Plano de ação · Top 3 motivos críticos** — recalculado conforme os filtros.

**Filtros funcionais:** canal, sentimento e período — todos os gráficos e KPIs reagem em conjunto.

> Os gráficos de *Top 10 por canal* respeitam os filtros de **sentimento** e **período**, mas sempre mostram **todos os canais** (esse é o objetivo do bloco).

---

## 🧹 Tratamento dos dados (regra de tags)

As tags automáticas do sistema são **ignoradas na contagem de demandas** (mas o comentário continua valendo). Removidas exatamente estas — e somente estas:

`Comentário duplicado`, `Comentário não encontrado`, `Dúvida`, `Hater Hidden`, `Problema`, `Publicação não encontrada`, `Redes`, `Removed_From_Social_Network`, `Sentiment_Edited`, `Waiting_Opinion`, `answered_with_text`, `replied`, `Lojas`.

Para o **ranking de "motivos críticos"** (plano de ação), além dessas, são desconsideradas do *ranking* as tags que não representam problema: `Elogio`, `Liked`, `Feedback`, `Sem demanda`, `Demanda não especificada`. Elas continuam aparecendo nos demais gráficos.

---

## 🔗 Fonte de dados em tempo real

O navegador busca o CSV direto da planilha a cada carregamento / clique em **Atualizar**:

```
https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>
```

Configurado em [`app.js`](app.js):

```js
const SHEET_ID  = "1gbpFMNy8M_ju895hMa8NnFexKNFxwYH3";
const SHEET_GID = "1416232087";
```

> **Importante:** a planilha precisa estar compartilhada como **"Qualquer pessoa com o link · Leitor"**. Sem isso o navegador não consegue ler e o dashboard mostra um aviso. Os dados ficam visíveis a quem tiver o link do dashboard.

Para trocar de planilha/aba, basta editar `SHEET_ID` e `SHEET_GID`. As colunas esperadas são: `Data` (DD/MM/AAAA), `Serviço`, `Sentimento`, `Tags` (separadas por vírgula).

> ⚠️ **Não funciona abrindo o arquivo direto (duplo clique / `file://`).** O Google só libera a leitura para uma "origem" web de verdade. Em produção isso é resolvido pelo GitHub Pages (`https://...`). Para **testar localmente**, sirva a pasta por HTTP, por exemplo:
> ```powershell
> # com Python instalado:
> python -m http.server 8000
> # depois abra http://localhost:8000
> ```
> (Qualquer servidor estático em `http://localhost` serve — o que não funciona é o `file://`.)

---

## 🚀 Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `dashboard-demandas`).
2. Suba os arquivos na raiz — **inclua a pasta `assets/` e o `favicon.svg`**, senão a logo e as imagens não aparecem:
   ```bash
   git init
   git add index.html styles.css app.js favicon.svg assets README.md
   git commit -m "Dashboard de demandas NG.cash"
   git branch -M main
   git remote add origin https://github.com/<seu-usuario>/dashboard-demandas.git
   git push -u origin main
   ```
3. No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/root` → Save**.
4. Em ~1 minuto o dashboard fica em:
   `https://<seu-usuario>.github.io/dashboard-demandas/`

Sem build, sem servidor — é HTML/CSS/JS puro.

---

## 🎨 Identidade visual

Baseada no site **ng.cash**: fundo escuro `#131313`, verde-limão `#70ff00`, roxo `#7c2cff`, e as fontes **Sora** (títulos) + **IBM Plex Sans** (texto).

---

## 🛠️ Tecnologia

HTML + CSS + JavaScript puro, sem framework. Bibliotecas via CDN: **Chart.js** (gráficos) e **PapaParse** (leitura de CSV). Tudo client-side.
