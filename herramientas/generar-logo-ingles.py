# -*- coding: utf-8 -*-
"""Genera la versión en inglés del logotipo.

No usa ninguna tipografía instalada: recorta los glifos del propio
`sloganColor.png` y los vuelve a acomodar, así que las letras del eslogan en
inglés son exactamente las mismas del original. La única letra que no aparece en
"IDEAS CLARAS, SOLUCIONES CLARAS" es la T, y se arma con la barra superior de la
E y el asta de la I.

Uso:  copiar `sloganColor.png` (el archivo de marca original, 3163x779) junto a
este script y ejecutarlo. Produce `sloganColor-en.png`, del que salen después
`assets/img/logo-hero-en.png` y `assets/img/og-en.png`.
"""
from PIL import Image
import numpy as np

ORIGEN = 'sloganColor.png'
Y0, Y1 = 511, 580          # banda vertical del eslogan (bbox de los grises)
X_INICIO = 859             # el eslogan se alinea a la izquierda con el wordmark
HUECO_LETRA = 14
HUECO_PALABRA = 44
ESLOGAN_ES = 'IDEAS CLARAS, SOLUCIONES CLARAS'
ESLOGAN_EN = 'CLEAR IDEAS, CLEAR SOLUTIONS'

im = Image.open(ORIGEN).convert('RGBA')
a = np.array(im).astype(int)
r, g, b, al = a[:, :, 0], a[:, :, 1], a[:, :, 2], a[:, :, 3]
gris = (al > 20) & (abs(r - g) < 12) & (abs(g - b) < 12) & (abs(r - b) < 12)

# --- segmentar los glifos del eslogan original ---
banda = gris[Y0:Y1 + 1, :]
tinta = banda.sum(axis=0)
grupos, ini = [], None
for x in range(len(tinta)):
    if tinta[x] > 0 and ini is None:
        ini = x
    elif tinta[x] == 0 and ini is not None:
        grupos.append((ini, x - 1)); ini = None
if ini is not None:
    grupos.append((ini, len(tinta) - 1))

letras = [c for c in ESLOGAN_ES if c != ' ']
assert len(grupos) == len(letras), f'{len(grupos)} glifos vs {len(letras)} letras'

glifos = {}
for (x0, x1), letra in zip(grupos, letras):
    if letra in glifos:
        continue
    glifos[letra] = im.crop((x0, Y0, x1 + 1, Y1 + 1))
print('glifos disponibles:', ''.join(sorted(glifos)))

# --- la T no existe en el eslogan español: se arma con la barra de la E
#     y el asta de la I, así que sale del mismo tipo de letra ---
E, I = glifos['E'], glifos['I']
aE = np.array(E)[:, :, 3] > 40
anchoE = aE.shape[1]
filaTope = next(y for y in range(aE.shape[0]) if aE[y].any())   # la fila 0 va vacía
filasBarra = filaTope
while filasBarra < aE.shape[0] and aE[filasBarra].sum() >= anchoE * 0.9:
    filasBarra += 1
print('barra superior de la E:', filasBarra, 'px de alto;  ancho E:', anchoE, ' ancho I:', I.size[0])

T = Image.new('RGBA', E.size, (0, 0, 0, 0))
T.alpha_composite(I, ((E.size[0] - I.size[0]) // 2, 0))                    # asta centrada
T.alpha_composite(E.crop((0, filaTope, anchoE, filasBarra)), (0, filaTope)) # barra encima
glifos['T'] = T

# --- componer el eslogan en inglés con el mismo tracking ---
piezas, ancho = [], 0
for i, c in enumerate(ESLOGAN_EN):
    if c == ' ':
        ancho += HUECO_PALABRA
        continue
    if i > 0 and ESLOGAN_EN[i - 1] != ' ':
        ancho += HUECO_LETRA
    piezas.append((ancho, glifos[c]))
    ancho += glifos[c].size[0]
print(f'ancho del eslogan: ES {grupos[-1][1] - grupos[0][0] + 1} px  ·  EN {ancho} px')

# --- borrar el eslogan español y pegar el inglés ---
salida = im.copy()
limpio = np.array(salida)
limpio[gris] = (0, 0, 0, 0)
salida = Image.fromarray(limpio.astype('uint8'), 'RGBA')
for dx, sprite in piezas:
    salida.alpha_composite(sprite, (X_INICIO + dx, Y0))

salida.save('sloganColor-en.png')
print('escrito sloganColor-en.png', salida.size)
