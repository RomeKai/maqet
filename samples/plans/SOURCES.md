# Sources — samples/plans

Every file in this directory is an **original work generated during the
hackathon event** by `samples/tools/make_samples.py` (deterministic script,
fixed seed). No third-party plan, photo, dataset (including CubiCasa5K) or
web image was used, traced or copied. License: **CC0** (public domain).

| file | what | origin |
|---|---|---|
| `plano_48m_1ambiente.png` / `_photo.png` / `.truth.json` | clean 48 m² plan: 1 ambiente + cocina-baño | generated, CC0 |
| `plano_70m_2dorm.png` / `_photo.png` / `.truth.json` | clean 70 m² plan: 2 dormitorios | generated, CC0 |
| `croquis_ampliacion.png` / `_photo.png` / `.truth.json` | hand-drawn croquis with written measurements (dormitorio + baño, 6.00 × 3.50 m) | generated, CC0 |

Ground truth (`*.truth.json`) holds walls/openings/rooms in meters and loads
as `server/scene/models.py::Scene` (validated by the generator itself).
All outputs are **preliminary**; never a structural certification.
