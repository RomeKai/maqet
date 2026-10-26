# Maqet — Plan (Meta Global AI Developer Hackathon, Indie track)

**Entrega oficial:** miércoles 4/11, 21:00 GMT-5 = **23:00 ART**. **Entrega interna: 18:00 ART del 4/11.**
**Jurado:** viabilidad técnica · claridad de la propuesta · relevancia.
**Qué construimos:** `docs/PRODUCT.md`. **Cómo y por qué:** `docs/DECISIONS.md`. **Avance real:** `mme today` (gates en `mme/milestones.yaml`). **Pruebas y operación:** `docs/RUNBOOK.md`.

## Posicionamiento
> **Las apps de IA rediseñan fotos. Maqet rediseña el espacio medido, y se lo entrega a AutoCAD.**

## La idea en una frase
Sacá una foto del plano, reformá el espacio en vivo con un agente de IA, mostrale al cliente el resultado en AR sobre la
mesa y entregale a AutoCAD exactamente el mismo diseño como DXF con medidas reales.

## Arquitectura
```
foto del plano ─Spark visión─> muros propuestos ─(corregís + escala)─> ESCENA medida (única fuente de verdad)
                                                                            │
voz ─Voice Transcribe─> texto ─> agente Spark 1.3 (Responses + tools) ─ops validadas─┘
                                                                            │
                     ┌──────────────┬──────────────┬────────────────────────┼───────────────┐
                  3D (r3f)     AR maqueta (GLB/USDZ)   render (Muse Image)   DXF (ezdxf)   link para el cliente
```

## Días (gates en milestones.yaml) y misiones nocturnas

| Día | Fecha | Objetivo | Misión de esa noche |
|---|---|---|---|
| 1 | lun 26 | Esqueleto: Escena + ops + undo, FastAPI, PWA (3D a pantalla completa + hoja inferior + etapas), DXF de muros | `intake-cleanup` |
| 2 | mar 27 | **Capturar**: lectura del plano con Spark visión + editor de esquinas + escala | `asset-catalog` |
| 3 | mié 28 | 3D en los dos teléfonos + materiales, muebles y 5 estilos CC0 | `agent-tools` |
| 4 | jue 29 | **Diseñar**: agente v1 con tools por etapa, selección por toque, chat y push-to-talk | `variants-model` |
| 5 | vie 30 | **Presentar (1)**: proyectos + variantes A/B/C + link donde el cliente vota | `dxf-full-export` |
| 6 | sáb 31 | **Presentar (2)**: AR maqueta (iPhone + Android) + render Muse Image | `reform-ops` |
| 7 | dom 1 | **Reformar** lite (quitar/agregar tabique) + insignias de fidelidad (Medido / Concepto) + DXF completo | `quantities-takeoff` (cómputo de cambios) |
| 8 | lun 2 | **Freeze.** Cómputo en Entregar (viene de la noche) + grabar la demo en replay; pulir en los dos teléfonos | — |
| 9 | mar 3 | Deploy, README, video de 3 minutos | — |
| 10 | mié 4 | Buffer · `mme ship` · **enviar 18:00** | — |

**Orden de corte si vas atrasado** (está en `cut_if_late`): materiales imaginados → piezas conceptuales → `add_wall`
(queda solo quitar) → variante C → comentarios del cliente (quedan solo votos) → render por edición (pasás a "mood render").
**Lo que no se negocia:** Capturar con escala → Diseñar con el agente → variantes A/B → AR maqueta → cómputo + DXF.
**Filtro para toda decisión (ADR-020):** ¿refuerza la fidelidad, la entrega al profesional o la colaboración? Si no, va a CUTLIST.

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
- **Material para la demo:**
  - 3 planos con derechos de uso: tu casa, un plano de dominio público y un croquis a mano;
  - fotos de esos espacios;
  - una lista de 15 materiales y 15 muebles CC0 candidatos.
- Decidir las preguntas abiertas de `docs/PRODUCT.md`: modelo de negocio para el pitch y una marca inventada para el P1.

## Riesgos
1. **Lectura del plano** poco confiable → la IA propone, vos corregís y escalás. Las 3 muestras se graban en replay.
2. **AR pesado en el teléfono** → presupuestos del skill `ar-export`, testeados.
3. **Agente errático en vivo** → tools semánticas validadas, evals en ES/EN, y la demo grabada en replay.
4. **Licencias de assets** → solo CC0 y un test que lo verifica.
5. **Alcance** → gates diarios, cortes predefinidos y freeze el lunes 2.
