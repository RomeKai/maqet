# Maqet — Plan (Meta Global AI Developer Hackathon, Indie track)

**Entrega oficial:** miércoles 4/11, 21:00 GMT-5 = **23:00 ART**. **Entrega interna: 18:00 ART del 4/11.**
**Jurado:** Impacto 30% · Uso de herramientas Meta AI 25% ("ir más allá de una integración básica") · Profundidad técnica 20% · Demo 25% (video de 3 min). Tema: "Build for Your World". Bonos que encajan: Best Agentic Use-Case, Best Creative Build.
**Qué construimos:** `docs/PRODUCT.md`. **Cómo y por qué:** `docs/DECISIONS.md`. **Avance real:** `mme today` (gates en `mme/milestones.yaml`). **Pruebas y operación:** `docs/RUNBOOK.md`.

## Posicionamiento (pivote, ADR-022)
> **Las apps de IA rediseñan fotos. Maqet diseña la ampliación medida y le dice a la familia qué comprar en cada etapa.**

## La idea en una frase
Autoconstrucción asistida: un asistente técnico fotografía el croquis (o plano) de una familia, diseña con ella la
ampliación por voz con un agente de IA, se la muestra en AR sobre su mesa y entrega un cómputo de materiales por etapa de
obra más un DXF con medidas reales. Resultados preliminares; nunca certifican seguridad estructural.

## Arquitectura
```
foto de plano/croquis ─Spark visión─> muros propuestos ─(corregís + escala)─> ESCENA medida (única fuente de verdad)
                                                                                  │
voz (es) ─Voice Transcribe─> texto ─> agente Spark 1.3 (Responses + tools) ─ops validadas + reglas constructivas─┘
                                                                                  │
                  ┌──────────────┬──────────────┬─────────────────────┬───────────┴──┬──────────────────────────┐
               3D (r3f)     AR maqueta (GLB/USDZ)   render (Muse Image)   DXF (ezdxf)   cómputo por etapa + link familia
```

## Días (gates en milestones.yaml) y misiones nocturnas

| Día | Fecha | Objetivo | Misión de esa noche |
|---|---|---|---|
| 1 | lun 26 | Esqueleto: Escena + ops + undo, FastAPI, PWA (3D a pantalla completa + hoja inferior + etapas, textos es-AR/en en un diccionario), DXF de muros. **Regenerar los insumos de demo durante el evento**: planos y fotos, incluyendo al menos 1 croquis a mano con verdad de terreno (`*.truth.json`); el script generador anterior no está en el repo | `intake-cleanup` |
| 2 | mar 27 | **Capturar**: lectura de plano **y de croquis a mano** con Spark visión + editor de esquinas + escala | `asset-catalog` (materiales de construcción con recetas + set básico de muebles) |
| 3 | mié 28 | 3D en los dos teléfonos + reglas constructivas (`rules.py`: áreas mínimas, ventilación/iluminación, alturas, puertas, espesores, luz máxima) + banderas "requiere profesional matriculado" | `agent-tools` |
| 4 | jue 29 | **Reformar**: agente v1 con tools por etapa (agregar ambiente/muro/abertura), selección por toque, chat y push-to-talk en español | `variants-model` |
| 5 | vie 30 | **Entregar (1)**: cómputo por etapa (`takeoff.py`, recetas del catálogo) JSON + CSV, DXF completo, proyectos + link de solo lectura para la familia | `dxf-full-export` |
| 6 | sáb 31 | **Presentar**: AR maqueta (iPhone + Android) + render Muse Image del ambiente terminado; diseño liviano (cama entra, giro de puerta) | `reform-ops` |
| 7 | dom 1 | Insignias de fidelidad (Medido / Concepto / Preliminar) + variantes A/B si hay tiempo + P1: precios tipeados por el usuario y SAM 3.1 sobre fotos de obra | `quantities-takeoff` (afinar recetas y etapas) |
| 8 | lun 2 | **Freeze.** Grabar la demo de Rosa en replay (video en español, subtítulos en inglés); pulir en los dos teléfonos | — |
| 9 | mar 3 | Deploy, README, video de 3 minutos | — |
| 10 | mié 4 | Buffer · `mme ship` · **enviar 18:00** | — |

**Orden de corte si vas atrasado** (está en `cut_if_late`, ajustar al pivote): SAM 3.1 → precios tipeados → variantes A/B/C
(queda una sola propuesta) → render por edición (pasás a un render único del final) → diseño liviano de muebles →
`move_opening` (quedan agregar/quitar).
**Lo que no se negocia:** Capturar croquis con escala → agente que propone la ampliación con reglas y banderas → AR maqueta
→ cómputo por etapa + DXF.
**Filtro para toda decisión (ADR-020, ADR-022):** ¿refuerza la fidelidad (medido + reglas constructivas), el cómputo por etapa
o la colaboración con la familia? Si no, va a CUTLIST.

## Rutina diaria
**Terminal del agente:** `mme use gateway && claude` → `/resume-session` · `/ecc:plan "<objetivo del día>"`
**Terminal de operaciones** (`set -a; source .env; set +a`): `mme today` · `mme watchdog` · `mme gate` cuando creas que terminaste.
**Antes de dormir (5 min):** ajustá la misión de esa noche → commit → `mme night prep` → `mme night run --until 07:30`.
**A la mañana:** `NIGHT_REPORT.md` → revisás la rama → `git merge --no-ff` → `mme gate`.
**Probá en los dos teléfonos todos los días** (ADR-012): el AR y la cámara fallan distinto en iOS y en Android.

## Antes del kickoff (jue 22 – dom 25): setup y material
- `./setup.sh` · `mme doctor` · `mme gateway drill` ($0).
- Discord: (1) ¿se permiten asistentes de código que no sean de Meta? (2) ¿hay que declarar el uso de IA? (3) ¿se permite
  usar herramientas/librerías open source propias, como MME? → `mme policy ...`
- **Material para la demo (se regenera en el Día 1):**
  - 3 insumos con derechos de uso: un plano, un croquis a mano con medidas anotadas y una foto de una casa en etapas;
  - cada uno con su verdad de terreno;
  - lista de materiales de construcción con recetas (ladrillo, mezcla, cemento, arena, hierro, chapas) y un set mínimo de muebles CC0.
- Decidir las preguntas abiertas de `docs/PRODUCT.md`: fuentes de los valores de `rules.py` y contacto técnico para revisar reglas y recetas.

## Riesgos
1. **Lectura de croquis** poco confiable (más ruidosa que un plano) → la IA propone, el técnico corrige y escala. Las muestras se graban en replay.
2. **AR pesado en el teléfono** → presupuestos del skill `ar-export`, testeados.
3. **Agente errático en vivo** → tools semánticas validadas, evals en ES/EN, y la demo grabada en replay.
4. **Licencias de assets** → solo CC0 y un test que lo verifica.
5. **Alcance** → gates diarios, cortes predefinidos y freeze el lunes 2.
6. **Reglas y recetas incorrectas o desactualizadas** → conjunto chico, con fuente citada en el código, tests unitarios, resultados rotulados "preliminar" y banderas de profesional matriculado.
7. **Pivote tardío** (los gates de `mme/milestones.yaml` y las misiones nocturnas pueden seguir el alcance anterior) → alinearlos el Día 1.
