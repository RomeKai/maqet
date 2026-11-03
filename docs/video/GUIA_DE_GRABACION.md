# Guía de grabación de Maqet

Video final: 1920x1080, 30 fps, 2:50. Se graba por partes, en cualquier orden, y se une al final.

- **Celular A:** usa Maqet y graba su propia pantalla.
- **Celular B:** es la cámara. En horizontal va a pantalla completa; en vertical (dibujo o app filmada), va con su marco.
- **Laptop:** corre Maqet, graba el DXF y es donde se edita.

Marcá cada casilla al terminar. Guardá los clips con el nombre indicado.

## Paso 1. Preparar (una sola vez)

- [ ] Dibujar el croquis en una hoja blanca con marcador negro: la casa de 3 x 8 m, con puerta (1,50) y ventana (1,00), y las medidas escritas.
- [ ] Limpiar la mesa: que se vea solo la hoja. Grabar de día, cerca de una ventana.
- [ ] Celular A: No Molestar activado, brillo alto, batería cargada.
- [ ] Levantar el servidor en live y Maqet en `https://<ip-de-la-laptop>:5173`. Aceptar el certificado antes de grabar.
- [ ] Armar un soporte para el celular B: pila de libros o trípode.

### Dos pruebas de 10 segundos, antes de todo

- [ ] **AR:** grabar la pantalla del celular A durante una sesión AR. Si la cámara sale negra o congelada, filmar esa pantalla con el celular B.
- [ ] **Micrófono:** grabar la pantalla con micrófono mientras le hablás a Maqet. Si tu voz no queda en el video, Android no comparte el micrófono: que el celular B grabe el audio del pedido al lado tuyo, y lo sincronizás al editar.

## Paso 2. Grabar la voz en off

Primero la voz, porque marca el ritmo del corte. Celular o auriculares con micrófono a 15 cm, en una pieza con cortinas o ropa. Tres tomas de cada línea, sin apuro. Si te trabás, hacé una pausa y repetí la frase entera.

| Clip | Duración | Texto |
|---|---|---|
| V1 | 10 s | Before the event: planning docs, agent skills and my open-source MME harness. Everything you'll see in Maqet was built this week. |
| V2 | 21 s | Four million people in Argentina build their own homes, in stages, as they save. An architect or a designer from day one is rarely within reach, and a mistake gets paid for with their savings. Picture Rosa. She wants to add a bedroom, and all she has is this drawing. |
| V3 | 9 s | Maqet turns that drawing into a measured project: how it looks, what to buy at each stage, and a drawing for the professional. |
| V4 | 16 s | A technician visits with a phone. First Meta model: Muse Spark reads the drawing and the written measurements, for less than a cent. What's estimated says so. The AI proposes, a person decides. |
| V5 | 8 s | No drawing? The technician measures the room in augmented reality: corners, doors and windows, with real measurements. |
| V6 | 15 s | Back to Rosa. She asks in Spanish, with her own voice. Muse Voice Transcribe hears her, and Muse Wonder edits the home. But it doesn't draw: it only uses validated tools, and every change goes through construction rules written in code. |
| V7 | 6 s | And when something needs a professional, it says so. Maqet never certifies a structure. |
| V8 | 15 s | Muse Image shows how the room could look, starting from the measured geometry, not from the model's imagination. And in augmented reality, she sees her extension on her own table. |
| V9 | 24 s | And now, what no image app gives you. A material list by stage, to buy as she saves: bricks, cement, sand, steel. And a DXF with real measurements, for the professional who will review and sign it. No model writes these numbers: they come from deterministic code. |
| V10 | 21 s | Four Meta models, each in its place: Spark reads, Voice listens, Wonder edits, Image shows. And none of them is in charge: one measured scene is the source of truth, and 3D, AR, materials and DXF all derive from it. More than 1,500 automated tests, all open source. |
| V11 | 14 s | Everything is preliminary, and says so. Maqet doesn't replace the architect. It gives people who could never afford one a first measured project, from day one. |

## Paso 3. Grabar el recorrido principal (P1)

Es el clip más importante: una sola sesión, en live, con la misma casa de principio a fin. Grabá la pantalla del celular A con micrófono. Si una toma sale mal, empezá de nuevo. No toques Cancel durante la toma.

1. Abrir Capture, elegir el croquis, sacar la foto (acá también se filma M2).
2. Mostrar las paredes propuestas y detenerte 3 segundos.
3. Tocar una pared y corregir una medida. Dejar ver un aviso *estimated*. Tocar *Looks right*.
4. Mantener el micrófono y decir, en español: **"Agregá un dormitorio de tres por cuatro para mi hija, del lado norte."**
5. Esperar el resultado. Girar un poco el 3D para que se vea el cuarto nuevo. Debe aparecer un aviso de profesional: es la pared de 8 m, no un error.
6. Decir: **"Y agregá un segundo piso."** Detenerte en el aviso rojo y el banner en 2.
7. Decir: **"Deshacé eso."** La casa vuelve atrás.
8. Ir a Present y tocar *In real life*. Mostrar las vistas despacio.
9. Ir a Deliver. Bajar lento por la lista, frenar en ladrillos y cemento y mostrar *Preliminary*.
10. Descargar el DXF y pasarlo a la laptop.

Si alguien más puede decir los pedidos, mejor: suena a Rosa y no al narrador.

## Paso 4. Grabar los planos sueltos

| Clip | Con qué | Plano | Qué pasa | Duración |
|---|---|---|---|---|
| M1 | Celular B | Cenital: la hoja llena el cuadro, la mano entra por un costado | Terminar el croquis: una pared, la ventana, una medida. Hacer varias tomas y usar la más limpia | 25 s |
| M2 | Celular B | Lateral, a la altura de la mesa | El celular A saca la foto del croquis | 6 s |
| A1 | Celular B | Por encima del hombro, en una habitación real | El celular A apunta a la pared y toca dos esquinas | 10 s |
| A2 | Celular A, pantalla | La misma toma que A1, sin cortar | Dos esquinas, la pared con su medida, toque en una ventana, hoja de revisión | 40 s, se recorta |
| M3 | Celular B | Por encima del hombro, moviéndote despacio alrededor de la mesa | La maqueta AR de la casa con el cuarto nuevo sobre la mesa | 10 s |
| M4 | Celular B | Cenital | El croquis al lado del celular A con la casa terminada en 3D | 5 s |
| C1 | Laptop, Win+G | Pantalla completa | El DXF de P1 abierto en LibreCAD: prender y apagar capas | 15 s |
| C2 | Laptop, Win+G | Pantalla completa | La página del repo en GitHub, bajando un poco | 5 s |

Para A1 y A2 elegí una pared con luz y algo de textura. No hace falta terminar la habitación: es solo una muestra.

## Paso 5. Editar

Editor: CapCut de escritorio o DaVinci Resolve. Proyecto de 1920x1080 a 30 fps. Primero poné toda la voz en orden y después el video encima.

| Tiempo | Voz | Video | Plantilla |
|---|---|---|---|
| 0:00 | V1 | `card-opening.png` | Sola |
| 0:10 | V2 | M1 | Pantalla completa |
| 0:31 | V3 | 3 s de 3D (P1), 3 s de lista (P1), 3 s de DXF (C1) | Sin plantilla: los clips de P1 van centrados sobre fondo negro |
| 0:40 | V4 | M2, luego P1 pasos 2 y 3 | `frame-capture.png` |
| 0:56 | V5 | A1, luego A2 | `frame-measure.png` para A2 |
| 1:04 | Pedido 1, V6, pedido 2, deshacer, V7 | P1 pasos 4 a 7, con su audio solo en los pedidos | `frame-reform.png` |
| 1:36 | V8 | P1 paso 8, luego M3 | `frame-present.png` para P1 |
| 1:51 | V9 | P1 paso 9, luego C1 | `frame-deliver.png` para P1 |
| 2:15 | V10 | `card-architecture.png`, luego C2 | Sola |
| 2:36 | V11 | M4, luego `card-close.png` | Sola |

### Cómo usar una plantilla

1. Pista de abajo: la plantilla, estirada para que dure lo mismo que el clip.
2. Pista de arriba: el video del celular, achicado a 960 px de alto y encajado sobre el rectángulo negro.
3. Si tu pantalla es más angosta o más ancha que el rectángulo, centrala: los bordes negros no se notan.

### Marcos para video vertical del celular B

Tienen un rectángulo de 540 x 960 px, a 120 px del borde izquierdo y 60 px del borde superior, exacto para video 9:16.

- `frame-sketch.png`: mientras dibujás el croquis (M1 en vertical).
- `frame-filmed.png`: cuando el celular B filma la app corriendo en el celular A (M2, A1 o M3 en vertical, o el plan B de AR).

### Reglas de edición

- Solo cortes secos, sin zooms animados ni transiciones. Un recorte fijo sirve si algo no se lee.
- Recortá las esperas del modelo, pero nunca aceleres ni cambies un resultado. Las plantillas avisan que las esperas están recortadas.
- Silenciá el audio de P1, salvo los pedidos en español.
- Música opcional: instrumental y muy baja.
- Subtítulos: importá `subtitles.en.srt` y reajustalos al corte. Si tu editor no lo importa, usá subtítulos automáticos y corregí los nombres (Muse Spark, Muse Wonder, DXF). Con plantilla van abajo a la derecha, y a pantalla completa abajo al centro. Los pedidos en español tienen que llevar su traducción.

### Antes de exportar

- [ ] La línea de apertura es lo primero que se ve y se oye.
- [ ] Dura menos de 3:00.
- [ ] Se ve *Preliminary* y el aviso de profesional.
- [ ] No aparecen `.env`, claves, notificaciones ni advertencias del certificado.
- [ ] Nada está simulado: lo que se ve lo hizo la app.
- [ ] Exportar en H.264, subir a YouTube como "no listado" y abrir el link en una ventana de incógnito.
