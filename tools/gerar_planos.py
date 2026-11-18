"""Gera extension/talent-plans.js a partir de talentos.json da wiki oficial.

Uso: python tools/gerar_planos.py caminho/para/talentos.json
(o arquivo vem de https://levelingidle2d.com.br/wiki/_dados/talentos.json)
"""
import json
import pathlib
import sys

nos = {n['id']: n for n in json.load(open(sys.argv[1], encoding='utf-8'))['nos']}

# Ramos de cada senda de classe: nós em ordem, com a escolha 1-de-2 como tupla.
CLASSES = {
    'assassino': dict(core=('as_inicio', 'as0'), ec='as_ec', ramos={
        'execucao': ['asa1', 'asa2', 'as_predador', ('as_ea', 'as_abertura'), 'as_sentenca'],
        'hemorragia': ['asla', 'as_feridas', 'as_hemorragia', ('as_sede', 'as_sangria'), 'as_rasgo'],
        'danca': ['as_c1', 'as_c2', 'as_c3', ('as_c_frenesi', 'as_c_fugaz'), 'as_c_final'],
    }),
    'guerreiro': dict(core=('g_inicio', 'g0'), ec='g_ec', ramos={
        'impacto': ['ga1', 'ga2', 'g_maopesada', ('g_armadura', 'g_abalo'), 'g_sismico'],
        'furia': ['g_furia', 'gb1', 'g_roubo', ('g_ea', 'g_frenesi'), 'g_devastador'],
        'baluarte': ['g_c1', 'g_c2', 'g_c3', ('g_c_inabalavel', 'g_c_folego'), 'g_c_final'],
    }),
    'mago': dict(core=('m_inicio', 'm0'), ec='m_ec', ramos={
        'fluxo': ['mb1', 'mb2', 'mlb', ('m_mare', 'm_absorcao'), 'm_reserva'],
        'sobrecarga': ['ma1', 'ma2', 'mla', ('m_instavel', 'm_incendiar'), 'm_eb'],
        'gelo': ['m_c1', 'm_c2', 'm_c3', ('m_c_congelar', 'm_c_estilhacar'), 'm_c_final'],
    }),
    'arqueiro': dict(core=('ar_inicio', 'ar0'), ec='ar_ec', ramos={
        'rajada': ['arlb', 'ar_ritmo', 'arb2', ('ar_extra', 'ar_cacada'), 'ar_tempestade'],
        'atirador': ['ara1', 'ara2', 'ar_firme', ('ar_ea', 'ar_primeira'), 'ar_pontofraco'],
        'saraivada': ['ar_c1', 'ar_c2', 'ar_c3', ('ar_c_fogo', 'ar_c_paciente'), 'ar_c_final'],
    }),
    'healer': dict(core=('s_inicio', 's0'), ec='s_ec', ramos={
        'restauracao': ['sa1', 's_periodica', 's_ea', ('s_misericordia', 's_prece'), 's_transbordar'],
        'protecao': ['sb1', 'slb', 's_duradouro', ('s_egide', 's_luzpunitiva'), 's_santuario'],
        'julgamento': ['s_c1', 's_c2', 's_c3', ('s_c_chama', 's_c_retribuicao'), 's_c_final'],
    }),
}

# Builds: nome da build de atributos do jogo -> ramo principal, escolha, ramo 2, escolha, ápice.
# Os pares de ramos vêm dos textos "Builds recomendadas" da wiki oficial; as escolhas
# 1-de-2 e o ápice são a nossa leitura (foco em caçar rápido).
BUILDS = {
    'assassino': [
        ('Lâmina Letal', 'danca', 'as_c_frenesi', 'hemorragia', 'as_sede', 'as_key2'),
        ('Executor', 'execucao', 'as_abertura', 'hemorragia', 'as_sede', 'as_key'),
        ('Vento Sombrio', 'danca', 'as_c_fugaz', 'hemorragia', 'as_sede', 'as_key3'),
    ],
    'guerreiro': [
        ('Berserker', 'furia', 'g_frenesi', 'baluarte', 'g_c_inabalavel', 'g_key'),
        ('Destruidor', 'impacto', 'g_armadura', 'furia', 'g_frenesi', 'g_key'),
        ('Colosso', 'baluarte', 'g_c_inabalavel', 'furia', 'g_frenesi', 'g_key3'),
    ],
    'mago': [
        ('Arquimago', 'sobrecarga', 'm_incendiar', 'fluxo', 'm_absorcao', 'm_key'),
        ('Rajada Arcana', 'gelo', 'm_c_estilhacar', 'sobrecarga', 'm_incendiar', 'm_key'),
        ('Guardião Arcano', 'fluxo', 'm_absorcao', 'gelo', 'm_c_congelar', 'm_key3'),
    ],
    'arqueiro': [
        ('Atirador de Elite', 'rajada', 'ar_cacada', 'atirador', 'ar_ea', 'ar_key'),
        ('Chuva de Flechas', 'saraivada', 'ar_c_fogo', 'rajada', 'ar_cacada', 'ar_key'),
        ('Batedor', 'rajada', 'ar_cacada', 'saraivada', 'ar_c_fogo', 'ar_key3'),
    ],
    'healer': [
        ('Julgador', 'julgamento', 's_c_chama', 'restauracao', 's_prece', 's_key2'),
        ('Clérigo', 'restauracao', 's_misericordia', 'protecao', 's_egide', 's_key'),
        ('Cruzado', 'protecao', 's_luzpunitiva', 'julgamento', 's_c_chama', 's_key2'),
    ],
}

FUND_1 = [('f_raiz', 1), ('f_forca', 5)]
AMB_1 = [('am_inicio', 1), ('am_ouro', 5), ('am_xp', 5)]
FUND_2 = [('f_letalidade', 4), ('f_pontaria', 3), ('f_intelecto', 1), ('f_reflexos', 5)]
AMB_2 = [('am_drop', 4), ('am_captura', 5), ('am_key', 1)]
SOMBRA = [('sb_inicio', 1), ('sb_tronco', 5), ('sb_lamina', 2), ('sb_olhos', 5), ('sb_carne', 2),
          ('sb_presteza', 2), ('sb_fome', 4), ('sb_pacto', 4), ('sb_extracao', 2), ('sb_vinculo', 2),
          ('sb_chamado', 2), ('sb_key', 1)]
FUND_3 = [('f_vitalidade', 5), ('f_intelecto', 5), ('f_couraca', 3), ('f_barreira', 3)]


def req_level(child, parent):
    for r in nos[child]['requisitos']:
        if parent in r['nos']:
            return r['nivel']
    raise KeyError((child, parent))


def ramo(nodes, escolha):
    """Caminho rápido até o fecho do ramo (só o mínimo de cada nó), depois completa os nós."""
    assert escolha in nodes[3], escolha
    seq = [escolha if isinstance(n, tuple) else n for n in nodes]
    passos = [(seq[i], req_level(seq[i + 1], seq[i])) for i in range(len(seq) - 1)]
    passos.append((seq[-1], nos[seq[-1]]['maxNivel']))
    passos += [(n, nos[n]['maxNivel']) for n in seq[:-1]]
    return passos


def plano(classe, ramo1, esc1, ramo2, esc2, apice):
    c = CLASSES[classe]
    ini, raiz = c['core']
    r1, r2 = c['ramos'][ramo1], c['ramos'][ramo2]
    p = [(ini, 1), (raiz, req_level(r1[0], raiz))]
    p += FUND_1
    p += ramo(r1, esc1)
    p += [(raiz, nos[raiz]['maxNivel'])]
    p += AMB_1
    p += ramo(r2, esc2)
    p += [(c['ec'], nos[c['ec']]['maxNivel']), (apice, 1)]
    p += FUND_2 + AMB_2 + SOMBRA + FUND_3
    for nid, lvl in p:
        assert nid in nos and 1 <= lvl <= nos[nid]['maxNivel'], (nid, lvl)
    return [f'{n}:{lvl}' for n, lvl in p]


saida = {cl: [{'build': b[0], 'ramos': [b[1], b[3]], 'passos': plano(cl, *b[1:])} for b in lista]
         for cl, lista in BUILDS.items()}
arvores = {n['id']: n['arvore'] for n in nos.values()}
js = ('// Gerado por tools/gerar_planos.py a partir da wiki oficial. Não edite à mão.\n'
      f'window.__lvlTalentPlans = {json.dumps(saida, ensure_ascii=False)};\n'
      f'window.__lvlTalentTree = {json.dumps(arvores, ensure_ascii=False)};\n'
      f'window.__lvlTalentName = {json.dumps({n["id"]: n["nome"] for n in nos.values()}, ensure_ascii=False)};\n')
out = pathlib.Path(__file__).resolve().parent.parent / 'extension' / 'talent-plans.js'
out.write_text(js, encoding='utf-8')
print('ok', out, {cl: [len(b['passos']) for b in v] for cl, v in saida.items()})
