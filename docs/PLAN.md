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
A. AR (WebXR, Android): toques de esquinas en el piso ──────────┐
B. foto de ambiente + toques y largos tipeados ─────────────────┼─> muros con medida y procedencia por muro
C. croquis ─Spark visión─> muros + medidas escritas ─solver por muro┘   ─(corregís)─> ESCENA medida (única fuente de verdad)
   (SAM 3.1, P1: aberturas de fotos de muro medido)                                          │
voz (es) ─Voice Transcribe─> texto ─> agente Spark 1.3 (Responses + tools) ─ops validadas + reglas constructivas─┘
                                                                                  │
                  ┌──────────────┬──────────────┬─────────────────────┬───────────┴──┬──────────────────────────┐
               3D (r3f)     AR maqueta (GLB/USDZ)   render (Muse Image)   DXF (ezdxf)   cómputo por etapa + link familia
```

## Capturar: tres modos (ADR-025)
- **A. Medir en AR (WebXR, Android Chrome + ARCore): camino principal del video de demo.** Tocás cada esquina del ambiente en el piso; cada toque es un punto 3D en metros. En iPhone Safari no hay WebXR: la UI detecta soporte y ofrece B/C.
- **B. Foto de ambiente + toques (cualquier teléfono, iPhone incluido):** tocás dos puntos y tipeás el largo ("3,50"); tocás una ventana o puerta y tipeás el ancho.
- **C. Croquis con medidas escritas (respaldo, sin visita):** cada muro toma **su propio** largo escrito (restricciones por muro, no un factor global); un solver determinista ajusta la geometría y conserva la topología. Muros sin medida: *estimado*; contradicciones: aviso al técnico.
- **Procedencia por muro** en la Escena: `measured_ar | measured_tape | written_on_sketch | estimated`; visible en la UI y en el cómputo (cantidades estimadas rotuladas).
- **WebXR exige HTTPS** (contexto seguro): por `http://192.168.x.x:5173` en la LAN no funciona. Hay que servir el web de desarrollo por HTTPS o por un túnel.
- **Regla de calidad (lección del 26/10):** los gates del Día 1 y 2 pasaron probando piezas sueltas, pero nada estaba conectado (no había `POST /intake`, la web no llamaba al servidor, `IntakeScreen` no estaba montado). **Cada día tiene al menos un gate de integración** (una ruta + un test de API de punta a punta, la App renderiza la pantalla de la etapa, o un test de upload a Escena).

## Días (gates en milestones.yaml) y misiones nocturnas

| Día | Fecha | Objetivo | Misión de esa noche |
|---|---|---|---|
| 1 | lun 26 | Esqueleto: Escena + ops + undo, FastAPI, PWA (3D a pantalla completa + hoja inferior + etapas, textos es-AR/en en un diccionario), DXF de muros. **Regenerar los insumos de demo durante el evento**: planos y fotos, incluyendo al menos 1 croquis a mano con verdad de terreno (`*.truth.json`); el script generador anterior no está en el repo | `intake-cleanup` |
| 2 | mar 27 | **Integración + Capturar con medidas por muro.** Primero, conectar todo: `POST /intake` (multipart imagen + `kind`) → `read_plan` (replay por defecto) → cleanup → borrador de Escena; script `dev` en `web` (`vite --host`); `IntakeScreen` montado en Capturar; la web llama a la API con `VITE_API_URL`. Después: modelo de medida por muro (campo de procedencia) + **modo B** (foto + toques) + **modo C** (croquis con solver por muro). Agregar un croquis **deliberadamente no proporcional** con verdad de terreno (se regenera durante el evento) para que los tests atrapen el bug de escala global | `asset-catalog` (materiales de construcción con recetas + set básico de muebles) |
| 3 | mié 28 | **Modo A: medir en AR (WebXR), su propio día.** Primer paso, antes de escribir código: verificar que el teléfono Android soporta WebXR AR (Chrome + Google Play Services for AR) con el sample oficial de hit-test de immersive-web. Servir el web de desarrollo por **HTTPS** (`@vitejs/plugin-basic-ssl` + `vite --host`, aceptando el certificado autofirmado en el teléfono) o por un túnel. Después: toques de esquinas → puntos en metros → muros `measured_ar`, altura de cielorraso (un toque o 2,60), detección de soporte con respaldo a B/C. Además: 3D desde la Escena (las reglas constructivas ya están hechas; catálogo de la noche). **Si WebXR falla en el teléfono, la demo usa el modo B.** | `agent-tools` |
| 4 | jue 29 | **Reformar**: agente v1 con tools por etapa (agregar ambiente/muro/abertura), selección por toque, chat y push-to-talk en español; ruta del agente y chat montado en la App | `variants-model` |
| 5 | vie 30 | **Entregar (1)**: cómputo por etapa (`takeoff.py`, recetas del catálogo) JSON + CSV con cantidades "estimadas" rotuladas según la procedencia de los muros, DXF completo, proyectos + link de solo lectura para la familia; primer test de flujo completo (croquis → Escena → reforma → cómputo → DXF) | `dxf-full-export` |
| 6 | sáb 31 | **Presentar**: AR maqueta (iPhone + Android) + render Muse Image del ambiente terminado; diseño liviano (cama entra, giro de puerta) | `reform-ops` |
| 7 | dom 1 | Insignias de fidelidad (Medido / Concepto / Preliminar + procedencia por muro) + **P1: SAM 3.1** aberturas desde fotos de muro medido (ataca el 2/5 de aberturas en croquis) + precios tipeados y variantes A/B si hay tiempo | `quantities-takeoff` (afinar recetas y etapas) |
| 8 | lun 2 | **Freeze.** Grabar la demo de Rosa en replay (video en español, subtítulos en inglés; captura en AR en Android como camino principal, B/C como respaldo); pulir en los dos teléfonos | — |
| 9 | mar 3 | Deploy, README, video de 3 minutos | — |
| 10 | mié 4 | Buffer · README y demo finales · `mme ship` · **enviar 18:00** | — |

**Orden de corte si vas atrasado** (está en `cut_if_late`): precios tipeados → variantes A/B/C (queda una sola propuesta)
→ SAM 3.1 (aberturas manuales) → render por edición (pasás a un render único del final) → diseño liviano de muebles →
`move_opening` (quedan agregar/quitar). Dentro de Capturar: contradicciones del solver (solo avisos, sin resolución guiada) →
aberturas por toque del modo B → **Modo A: si WebXR falla en el teléfono, la demo usa el modo B (con C de respaldo)**.
**Lo que no se negocia:** Capturar con medida por muro (modo C como mínimo, nunca un factor global) → agente que propone la
ampliación con reglas y banderas → AR maqueta → cómputo por etapa + DXF → un gate de integración por día.
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
8. **Modo A depende del teléfono y de HTTPS:** WebXR no corre por `http://` en la LAN ni en iPhone → verificar soporte con el sample oficial antes de escribir código, servir por HTTPS o túnel, y tener B/C listos como demo alternativa (ADR-025). La precisión depende de la luz y la textura del piso.
9. **Croquis reales no proporcionales** (un factor de escala global da muros mal) → medida por muro + solver; fixture no proporcional en los tests.
10. **Integración tardía** (piezas verificadas pero desconectadas, 26/10) → gate de integración todos los días; el primer bloque del 27/10 se dedica a conectar.
