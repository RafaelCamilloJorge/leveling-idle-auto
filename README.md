# Leveling Idle – Auto Pontos, Equipar e Exército

Extensão para o **IdleDeck** (também funciona como script do Tampermonkey) que automatiza tarefas repetitivas do [Leveling Idle 2D](https://levelingidle2d.com.br/jogar), clicando só nos botões que o próprio jogo já tem:

| O quê | Como | Quando |
|---|---|---|
| Pontos de atributo | Status → **Distribuir pela build** (build escolhida) | Quando aparece o **+N** de pontos livres, e a cada 15 min |
| Equipamento | Inventário → **Equipar melhores** (critério escolhido) | A cada 10 min |
| Exército | Exército → **Montar melhor time** | A cada 30 min |

Tudo é configurável no botão **AUTO** que aparece no canto inferior esquerdo do jogo.

> ⚠️ A extensão clica sozinha no jogo. Automação pode ser contra as regras e dar ban na conta. Use por sua conta e risco.

## Instalar no IdleDeck

1. Baixe o repositório (**Code → Download ZIP**) ou clone com `git clone`.
2. No IdleDeck, clique com o botão direito na conta → **Extensões...**
3. Ligue **Modo desenvolvedor** e clique em **Carregar pasta...**
4. Escolha a pasta **`extension`** deste repositório (a que tem o `manifest.json`).
5. Leia a análise, marque **"Entendi..."** e clique em **Adicionar à Conta X**.
6. No jogo, clique em **AUTO**, marque **Automação** e escolha a build e o critério.

Para outras contas: **Extensões** → troque a conta → **Já usadas** → **Analisar para Conta X**.

### Erro `EXDEV: cross-device link not permitted`

O IdleDeck está instalado num disco diferente do C:. Mova o app para o C: em
**Configurações do Windows → Aplicativos → IdleDeck → ⋯ → Mover**.

## Atualizar

1. Baixe a versão nova (ou `git pull`) **na mesma pasta** que você carregou no IdleDeck.
2. IdleDeck → **Extensões...** → **Recarregar da pasta** em cada conta.

## Tampermonkey (navegador)

Crie um script novo no Tampermonkey e cole o conteúdo de `extension/content.js`
(o cabeçalho `==UserScript==` já está no arquivo). Não abra a mesma conta no navegador e
no IdleDeck ao mesmo tempo: o jogo derruba uma das sessões.

## Desenvolvendo

- O código fica todo em `extension/content.js`.
- Ao mudar algo, suba a versão **nos dois lugares**: `// @version` no topo do `content.js`
  e `"version"` no `manifest.json`.
- Teste no IdleDeck com **Recarregar da pasta** e confira o log no painel **AUTO**.
- O jogo usa classes CSS como `.slHudPoints` (o "+N" de pontos), `.slInvBestBtn`
  (Equipar melhores), `.slShBestBtn` (Montar melhor time) e `button.slGmItem` (itens do
  Menu do Caçador). Se o jogo mudar, é por aí que algo quebra.

## Histórico

- **1.1.0** – Exército: "Montar melhor time" automático.
- **1.0.3** – Pontos: reage ao "+N" do cartão do personagem (o IdleDeck não mostra "Nível N").
- **1.0.2** – Abre o Status pelo "+N"/selo de nível (no IdleDeck o menu Caçador some).
- **1.0.1** – Lê os pontos livres pelo selo certo; nome do critério igual ao do jogo.
- **1.0.0** – Primeira versão: pontos pela build e "Equipar melhores".
