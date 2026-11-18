# Leveling Idle – Auto Pontos, Talentos, Equipar, Exército e Caçada

Extensão para o **IdleDeck** (também funciona como script do Tampermonkey) que automatiza tarefas repetitivas do [Leveling Idle 2D](https://levelingidle2d.com.br/jogar), clicando só nos botões que o próprio jogo já tem:

| O quê | Como | Quando |
|---|---|---|
| Pontos de atributo | Status → **Distribuir pela build** (build escolhida) | Quando aparece o **+N** de pontos livres, e a cada 15 min |
| Talentos | Árvore de Talentos → aprende 1 nível por vez (duplo clique) seguindo o plano da build | A cada 20 min, quando há pontos |
| Equipamento | Inventário → **Equipar melhores** (critério escolhido) | A cada 10 min |
| Exército | Exército → **Montar melhor time** | A cada 30 min |
| Área de caça | Caçadas → **Entrar no portal** da melhor área permitida (sozinho: a **★ Recomendada**; em party: veja abaixo) | A cada 20 min e ao subir de nível |

> **Em party** a área precisa servir para todo mundo: o limite é o **menor nível** entre você e
> os membros (lido no quadro da party). A extensão escolhe a maior área da trilha que começa até
> esse nível, pulando as trancadas e as com Precisão no vermelho. Se essa já for a atual, fica.
> Trocar de área não tira a conta da party.

Tudo é configurável no botão **AUTO** que aparece no canto inferior esquerdo do jogo.

> ⚠️ A extensão clica sozinha no jogo. Automação pode ser contra as regras e dar ban na conta. Use por sua conta e risco.

## Planos de talentos

Os pontos de talento vêm do Codex (marcos de abate) e servem para todas as sendas. A extensão
segue uma ordem fixa por build, gerada da [wiki oficial](https://levelingidle2d.com.br/wiki/atributos-habilidades-talentos)
por `tools/gerar_planos.py` (saída em `extension/talent-plans.js`). O plano usado tem o mesmo nome
da build de atributos (dá para trocar no painel **AUTO → Talentos → Plano**).

| Classe | Build | Ramos (principal + segundo) | Escolhas | Ápice |
|---|---|---|---|---|
| Assassino | Lâmina Letal | Dança das Sombras + Hemorragia | Frenesi das Sombras, Sede de Sangue | Lâmina do Abismo |
| Assassino | Executor | Execução + Hemorragia | Golpe de Abertura, Sede de Sangue | Mestre das Lâminas |
| Assassino | Vento Sombrio | Dança das Sombras + Hemorragia | Sombra Fugaz, Sede de Sangue | Fantasma |
| Guerreiro | Berserker | Fúria + Baluarte | Frenesi, Inabalável | Avatar do Colosso |
| Guerreiro | Destruidor | Impacto + Fúria | Armadura Partida, Frenesi | Avatar do Colosso |
| Guerreiro | Colosso | Baluarte + Fúria | Inabalável, Frenesi | Imortal |
| Mago | Arquimago | Sobrecarga + Fluxo Arcano | Incendiar, Absorção Arcana | Arquimago |
| Mago | Rajada Arcana | Gelo + Sobrecarga | Estilhaçar, Incendiar | Arquimago |
| Mago | Guardião Arcano | Fluxo Arcano + Gelo | Absorção Arcana, Congelamento | Escudo Arcano |
| Arqueiro | Atirador de Elite | Rajada + Atirador | Caçada Frenética, Tiro Certeiro | Olho do Falcão |
| Arqueiro | Chuva de Flechas | Saraivada + Rajada | Flechas Incendiárias, Caçada Frenética | Olho do Falcão |
| Arqueiro | Batedor | Rajada + Saraivada | Caçada Frenética, Flechas Incendiárias | Rastro do Vento |
| Sacerdote | Julgador | Julgamento + Restauração | Chama Sagrada, Prece Vital | Avatar da Luz |
| Sacerdote | Clérigo | Restauração + Proteção | Misericórdia, Égide Compartilhada | Santo Guardião |
| Sacerdote | Cruzado | Proteção + Julgamento | Luz Punitiva, Chama Sagrada | Avatar da Luz |

Os pares de ramos seguem as "Builds recomendadas" da wiki; as escolhas 1-de-2 e o ápice são a
nossa leitura, pensando em caçar rápido. Ordem de cada plano:

1. Início da senda da classe e o tronco até liberar os ramos.
2. Fundação: Alicerce e **Poder de Classe** (Ataque).
3. Ramo principal: caminho mais curto até o fecho do ramo, depois completa os nós.
4. Tronco no máximo, Ambição (**ouro** e **XP**).
5. Segundo ramo, o especial de 50 pontos e o ápice.
6. Resto da Fundação (crítico, velocidade), Ambição (drop, captura), Senda da Sombra e defesas.

A extensão nunca redefine a árvore (isso gasta Cristal). Se um nó estiver fechado por uma
escolha ou ramo que você já fez na mão, ela pula esse nó. Se faltar ponto para o próximo passo,
ela espera juntar, para não gastar fora da ordem.

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

- O código fica em `extension/content.js`; os planos de talento em `extension/talent-plans.js`
  (gere de novo com `python tools/gerar_planos.py talentos.json` quando o jogo mudar as sendas).
- Ao mudar algo, suba a versão **nos dois lugares**: `// @version` no topo do `content.js`
  e `"version"` no `manifest.json`.
- Teste no IdleDeck com **Recarregar da pasta** e confira o log no painel **AUTO**.
- O jogo usa classes CSS como `.slHudPoints` (o "+N" de pontos), `.slInvBestBtn`
  (Equipar melhores), `.slShBestBtn` (Montar melhor time), `.slHuntAccBad` (Precisão insuficiente) e `button.slGmItem` (itens do
  Menu do Caçador). Se o jogo mudar, é por aí que algo quebra.

## Histórico

- **1.5.0** – Talentos: investe os pontos de talento sozinho seguindo o plano da build (15 planos,
  5 classes), sem nunca redefinir a árvore.
- **1.4.0** – Caçadas em party: respeita o menor nível da party. Lê a trilha pelos botões de área
  do jogo (`.slAtlasNode`, com estado atual/liberada/trancada) e volta da ficha para a trilha na grade
  do IdleDeck.
- **1.2.1** – Caçadas: fecha o menu de categoria depois de usar; nome da área certo no log.
- **1.2.0** – Caçadas: vai sozinho para a área "Recomendada" pelo jogo.
- **1.1.0** – Exército: "Montar melhor time" automático.
- **1.0.3** – Pontos: reage ao "+N" do cartão do personagem (o IdleDeck não mostra "Nível N").
- **1.0.2** – Abre o Status pelo "+N"/selo de nível (no IdleDeck o menu Caçador some).
- **1.0.1** – Lê os pontos livres pelo selo certo; nome do critério igual ao do jogo.
- **1.0.0** – Primeira versão: pontos pela build e "Equipar melhores".
