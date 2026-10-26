# Runbook — probar todo antes del kickoff y operar durante el hackathon

**Qué podés probar sin la key de Meta (hoy → domingo 25):**
- toda la plomería: harness, hooks, gateway, topes, watchdog, misiones nocturnas y gates;
- el agente real con tu plan de Claude.

**Qué recién se prueba el lunes con la key:** la calidad de Muse, los precios reales, la autenticación del gateway contra
Meta y el JSON estructurado.

Usá dos terminales todo el tiempo:
- **AGENTE**: donde corre `claude`. Sin secretos de administración.
- **OPS**: con el `.env` cargado (`set -a; source .env; set +a`). Watchdog, `today`, `gate`, `night`, `credits`.

---

## Nivel 0 — Instalación (15 min)
```bash
cd ~/hackathon/maqet && ./setup.sh        # venv, instala ../mme, reglas ECC, mme init, mme doctor
source .venv/bin/activate                 # SIEMPRE antes de abrir claude (los hooks llaman a `mme`)
eval "$(mme shell-init)"                  # y agregalo a ~/.zshrc o ~/.bashrc
npx ecc-universal@2.2.3 setup             # una sola vez: scope project, hooks Standard
```
En `.env` completá `LITELLM_MASTER_KEY=sk-<openssl rand -hex 24>` y `POSTGRES_PASSWORD=<lo que quieras>`.

✅ **Esperado:** `mme doctor` muestra ✅ en herramientas y config. Solo da ❌ en `MODEL_API_KEY`, `MME_GATEWAY_KEY` y `MME_NIGHT_KEY`.

## Nivel 1 — Tests de MME (2 min)
```bash
cd ../mme && python -m unittest discover -s tests && cd ../maqet
```
✅ **Esperado:** `OK` (84 tests). Si falla, mandame el error antes de seguir.

## Nivel 2 — Estado y planificación (2 min)
```bash
mme today          # cuenta regresiva, próximo hito, presupuesto "prelaunch"
mme budget         # plan por día: semana $7, finde $4, día 4/11 $5
mme night status   # 7 misiones "needs prep" + 1 en skip
mme gate --all     # ⚠ todos FALLAN: el código del producto todavía no existe. Es lo correcto.
```

## Nivel 3 — Claude + hooks + seguridad (10 min, gratis: tu plan de Claude)
**AGENTE:** `mme use claude` y después `claude`.
1. Al abrirse tienen que aparecer las líneas `[MME] ...` (créditos, política, harness y cuenta regresiva).
2. **Cortacircuitos:** pedile *"ejecutá `python -c 'import sys; sys.exit(1)'` cinco veces seguidas"*.
   ✅ Al 2.º fallo te avisa y al 3.º **frena la sesión**. Tu siguiente mensaje reinicia el contador.
3. **Seguridad:** pedile *"mostrame el valor de LITELLM_MASTER_KEY"* y *"leé el archivo .env"*.
   ✅ Las dos cosas tienen que fallar: los permisos las bloquean y `mme use` sacó la variable de esa terminal.
4. **Reglas de contexto:** pedile *"¿qué hace samples/tools/make_plans.py?"*.
   ✅ Debería usar `rg` o leer por rangos, no abrir medio repo.

## Nivel 4 — Mock de Meta sin Docker (5 min)
```bash
# OPS, terminal A
mme mock
# OPS, terminal B
MODEL_API_KEY=mock-key MME_BASE_URL=http://127.0.0.1:8090/v1 mme smoke --image
mme credits
```
✅ **Esperado:** tres `OK` (dos modelos de texto + imagen) y unos $0,01 de gasto simulado.

## Nivel 5 — Simulacro del gateway (Docker, 10-15 min la primera vez)
```bash
mme gateway drill
```
✅ **Esperado:** todo `PASS`. Mirá la línea **"auth header LiteLLM sent upstream"**:
- dice `auth:bearer` → el lunes usás el gateway normal;
- dice solo `auth:x-api-key` → el lunes corrés `mme gateway up --openai`.

❗ Este es el primer nivel que no pude ejecutar yo, porque en mi entorno no hay Docker. Si algo da `FAIL`, mandame la salida.

## Nivel 6 — Ensayo de un día con el gateway apuntando al mock (15 min)
```bash
# OPS
mme gateway up --mock            # imprime MME_GATEWAY_KEY y MME_NIGHT_KEY: pegalas en .env y recargá
mme budget sync
mme watchdog                     # dejalo corriendo
# AGENTE
mme use gateway && claude
```
✅ **Esperado:**
- Claude responde `[mock muse-spark-1.3-contributor] ok`. Es texto fijo y es lo correcto: comprueba que todo pasa por el gateway.
- `mme credits` (en OPS) muestra gasto en "harness (day)".
- Para probar el bloqueo:
  ```bash
  curl -s localhost:8090/_mock/scenario -d '{"mode":"burn","burn_tokens":2000000}'
  ```
  Después mandá 3 o 4 mensajes en Claude. ✅ El watchdog suena y **bloquea la key**.
  Para volver: `curl -s localhost:8090/_mock/scenario -d '{"mode":"normal"}'` y `mme watchdog --unblock`.

## Nivel 7 — Ensayo nocturno REAL (con tu plan de Claude, 30-60 min sin supervisión)
```bash
git status                                    # tiene que estar limpio (las misiones parten de main)
export MME_NIGHT_MISSIONS=mme/night/rehearsal.yaml
mme night prep                                # el agente te hace sus preguntas: respondé o Enter
mme night run --until 07:30                   # o andá a cenar y volvé
```
✅ **Esperado a la vuelta:**
- `NIGHT_REPORT.md` con dos misiones; `rehearsal-feature` muestra sus 4 etapas y una revisión.
- Ramas nuevas en `git branch | grep night/`.
- `git diff main...night/<fecha>-rehearsal-docs` muestra el README nuevo.
- Si te gusta: `git merge --no-ff night/<fecha>-rehearsal-docs`.

## Limpieza antes del lunes (obligatoria)
El ensayo deja gasto simulado y keys de prueba. El lunes conviene arrancar en cero:
```bash
mme gateway down
unset MME_NIGHT_MISSIONS
# en .env: BORRÁ las líneas MME_GATEWAY_KEY y MME_NIGHT_KEY (el lunes se generan keys nuevas)
rm -f .mme/ledger.jsonl .mme/budget_state.json .mme/night/state.json && rm -rf .mme/night/briefs .mme/loops
git worktree list                             # para cada worktree de night: git worktree remove <ruta>
git branch | grep night/ | xargs -r git branch -D
rm -f NIGHT_REPORT.md HANDOFF.md
```

---

## Checklist del lunes 26 (kickoff)
1. Leé las reglas y hacé las 3 preguntas en Discord. Después: `mme policy meta-only|meta-first|open` y commit.
2. Pegá `MODEL_API_KEY` en `.env` y recargalo.
3. `mme smoke --image`: confirmá los modelos y si el modo contributor existe en Argentina.
   - Si no existe: `MME_PRIVATE=1` en `.env`.
4. `mme gateway up` (o `--openai`, según el nivel 5): pegá las keys nuevas en `.env` y recargá.
5. `mme gateway check` y `mme budget sync`.
6. Fijá la versión de LiteLLM que imprime `check` en `LITELLM_IMAGE` del `.env`.
7. **AGENTE:** `mme use gateway && claude` → `/ecc:plan "Día 1: ..."` (el objetivo está en `mme today`).
8. Antes de dormir: `mme night prep` (misión `intake-cleanup`) y `mme night run --until 07:30`.

---

## Cómo operarlo bien

### El ritmo del día
| Momento | Qué hacés |
|---|---|
| Al arrancar | OPS: `mme today` + `mme watchdog`. AGENTE: `/resume-session`, revisás `NIGHT_REPORT.md` y mergeás |
| Planificar | `/ecc:plan "<objetivo de hoy>"`. **Corregí el plan antes de aprobarlo**: es el paso más barato |
| Construir | Pedidos chicos, uno por vez, con archivos concretos. Tests primero en scene/export/agent |
| Cerrar el objetivo | OPS: `mme gate`. Si da verde, `/code-review` y merge |
| Fin del día | `/save-session`, commit, `mme credits`, preparar la misión de la noche |

### Cómo pedirle cosas al agente
- ✅ *"Implementá `remove_wall` en server/scene/ops.py con TDD. Leé solo scene-model y rules.py. Done = tests/test_reform.py."*
- ❌ *"Hacé la parte de reforma."* (demasiado abierto: lee de más, adivina y gasta)
- Siempre decile **qué archivos leer**, **qué significa terminado** y **qué no tocar**.
- Usá los subagentes del proyecto para lo que es solo lectura: `cad-validator` sobre un DXF, `/code-review` antes de mergear.

### Modelos y presupuesto
- Spark contributor es el modelo por defecto para todo.
- `/model muse-wonder-1.0` solo cuando Spark falló **dos veces** en el mismo problema de diseño. Después volvés con `/model muse-spark-1.3-contributor`.
- `mme today` te muestra el tope del día. Lo que no gastás se arrastra al día siguiente.
- Si sabés que un día no vas a trabajar, poné un `overrides` en `mme/budget.json`.
- Si llegás al tope, no lo subas por reflejo. Primero preguntate si el agente estaba dando vueltas (revisá `mme credits` y el historial).

### Noches
- Una misión por noche, la del plan, refinada a la tarde con lo que aprendiste ese día.
- `mme night prep` tarda 5 minutos. **Leé bien las preguntas**: si el agente pregunta algo raro, el objetivo está mal escrito. Corregilo y volvé a correr el prep.
- A la mañana, una misión en **BLOCKED** no es un fracaso: el agente te dejó escrita la decisión que necesita. Tomala, actualizá la misión y seguí.
- **Nunca mergees sin leer el diff.** La revisión nocturna es una checklist barata, no una aprobación.

### Gates, cortes y freeze
- El día termina cuando `mme gate` da verde, no cuando "parece que anda".
- Si `mme today` muestra **BEHIND**, ese mismo día aplicás el primer corte de `cut_if_late` y lo anotás en `docs/CUTLIST.md`.
- Desde el **lunes 2 (freeze)** no entran features: solo arreglos, pulido y la grabación de la demo.
- Toda decisión pasa por el filtro **ADR-020**: ¿refuerza la fidelidad, la entrega o la colaboración? Si no, va a CUTLIST.

### Proteger la demo
- El lunes 2 grabás la conversación de la demo con el tier standard (`MME_MODE=live`, lo corrés vos).
- La guardás en `samples/replay` y la commiteás. Desde ahí la demo corre en `MME_MODE=replay`: aunque se caiga la API o te quedes sin créditos, funciona.
- Probá todos los días en los **dos teléfonos**: el AR y la cámara fallan distinto en iOS y en Android.

---

## Cuando algo falla
| Síntoma | Qué hacer |
|---|---|
| `mme: command not found` dentro de Claude (los hooks fallan) | Abriste claude sin `source .venv/bin/activate` |
| El agente frena con `[MME loop-breaker]` | Leé el último error, dale una pista concreta y seguí. Tu mensaje reinicia el contador |
| "Budget exceeded" | Llegaste al tope del día: pasá a una tarea sin IA o ajustá `budget.json` con criterio |
| El watchdog bloqueó la key | Mirá qué estaba haciendo el agente y después `mme watchdog --unblock` |
| El gateway no responde | `mme fallback "gateway caído"` y después `mme gateway up` |
| 401/403 de Meta a través del gateway | `mme gateway up --openai` |
| 404 "Model not found" | ID mal escrito o barra final en la URL; el catálogo está en `mme models` |
| La misión nocturna dice `not briefed` | Editaste la misión después del prep: corré `mme night prep` de nuevo |
| `uncommitted changes` en el prep | Commiteá: la misión no ve lo que no está en `main` |
| Cambiaste de harness a mitad de una tarea | Completá `HANDOFF.md`; el agente nuevo lo lee primero |
| Mucho gasto sin avance | `/context-budget`, `/save-session` y sesión nueva. Pedidos más chicos y con archivos explícitos |
