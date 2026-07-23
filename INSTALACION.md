# Ficha de Bicicletas — instalación y uso (v1.9.0)

Herramienta independiente (no depende de Claude) que se instala una vez en Chrome y funciona en cualquier equipo. Extrae la ficha técnica y las fotos de una bici en la web de la marca, la muestra en pantalla, y la exporta a PDF y Word.

## 0. Publicar el script en GitHub (una sola vez)

El script está preparado para autoactualizarse solo en todos los equipos donde lo instales, usando un repositorio público de GitHub como fuente. Solo hay que configurarlo una vez:

1. Entra en [github.com](https://github.com) e inicia sesión (o crea una cuenta gratuita).
2. Crea un repositorio nuevo → **público** → por ejemplo `bike-spec-extractor`. No hace falta marcar ninguna opción especial (README, licencia, etc.).
3. Sube estos tres archivos al repositorio (botón "Add file" → "Upload files", o arrastrándolos):
   - `bike-spec-extractor.user.js`
   - `INSTALACION.md`
   - `README.md`
4. Abre `bike-spec-extractor.user.js` dentro de GitHub y pulsa el botón **"Raw"**. Copia esa URL — tendrá esta forma:
   `https://raw.githubusercontent.com/TU-USUARIO/bike-spec-extractor/main/bike-spec-extractor.user.js`
5. Edita el archivo (con el lápiz de GitHub o en local) y sustituye, en las líneas `@updateURL` y `@downloadURL` de la cabecera, `<TU-USUARIO-GITHUB>` y `<TU-REPO>` por tus valores reales, para que coincidan con la URL del paso 4. Guarda (commit).

A partir de aquí, cada vez que quieras publicar una mejora del script, basta con subir el archivo actualizado a ese mismo repositorio (sobrescribiendo el anterior) — Tampermonkey detectará la nueva versión solo en todos los equipos.

## 1. Instalar en un equipo (Tampermonkey)

**Opción A — recomendada, con autoactualización:**

1. Instala la extensión **Tampermonkey** desde la Chrome Web Store (gratuita).
2. Abre en el navegador la URL "Raw" del script (paso 4 anterior) que termina en `bike-spec-extractor.user.js`.
3. Tampermonkey detecta que es un userscript y muestra su propia pantalla de instalación → pulsa **"Instalar"**.
4. Listo. Este equipo comprobará automáticamente si hay versiones nuevas en el repositorio y las instalará (o avisará, según la configuración de Tampermonkey).

**Opción B — manual, sin repositorio:**

1. Instala **Tampermonkey**.
2. Abre el icono de Tampermonkey → **Crear un script nuevo**.
3. Borra el contenido de ejemplo y pega todo el contenido del archivo `bike-spec-extractor.user.js`.
4. Guarda con `Ctrl+S`.

Con la opción B, cada actualización futura hay que volver a copiar/pegar el script a mano en cada equipo — por eso se recomienda la opción A.

### Importante: cada vez que actualices el script

Trek es una SPA (Vue): un simple F5 sobre una pestaña que ya tenías abierta puede seguir ejecutando la versión anterior del script, aunque la hayas guardado bien en Tampermonkey. Tras editar el script:

1. **Cierra del todo** la pestaña de Trek (no solo refrescar).
2. Ábrela de nuevo desde cero.
3. Comprueba el build activo pasando el ratón por encima del botón "📋 Extraer ficha" (tooltip), mirando la consola del navegador, o en el pie del modal de vista previa: debe decir `v1.9.0`.

Si tras cerrar/reabrir sigues viendo un build antiguo, revisa en el panel de control de Tampermonkey que no haya más de una entrada del script activa.

## 2. Uso

1. Entra en `trekbikes.com` y navega hasta la ficha de una bici concreta.
2. Abajo a la derecha aparece un botón **"📋 Extraer ficha"**. Púlsalo.
3. Se abre un **menú de configuración** antes de generar nada, donde eliges:
   - **Apartados a incluir**: Especificaciones, Galería de fotos, Tabla de SKUs, Garantías (cada uno con su casilla, todos marcados por defecto).
   - **Tipo de garantía** (solo si el apartado está marcado): persona física o persona jurídica — cambia el texto legal incluido.
   - **Cliente**: nombre del destinatario de la ficha (aparece en la portada).
   - **Descuento sobre el PVP**: un importe en euros o un porcentaje; la portada calculará y mostrará "Descuento aplicado" y "Tu precio final".
4. Al confirmar, se extraen los datos y las fotos, y se abre una vista previa con toda la información ya aplicada.
5. Desde la vista previa puedes:
   - **Descargar PDF** o **Descargar Word**: la ficha profesional completa (portada, especificaciones, galería de hasta 6 fotos, tabla de SKUs y garantías, según lo elegido en el menú).
   - **Descargar fotos (N)**: descarga al PC **todas** las fotos detectadas en la página (no solo las 6 de la galería), en formato `.jpg`, nombradas con el SKU de la bici: `{sku}.jpg`, `{sku}_1.jpg`, `{sku}_2.jpg`... Se descargan una a una con una pequeña pausa entre ellas para evitar que el navegador bloquee las descargas.

Si algún dato no se detecta bien, la vista previa avisa con un mensaje; puedes seguir exportando igualmente, solo que ese campo saldrá vacío en el documento.

## 3. Añadir otra marca (Orbea, Mondraker...)

El script ya está preparado para estas dos marcas, pero de forma "genérica" (usa el mismo motor de extracción universal que en Trek). Para afinarlo a la web real de una marca:

1. Abre el script en Tampermonkey.
2. Busca el bloque `ADAPTERS`.
3. Dentro del adaptador de esa marca (`id: 'orbea'` o `id: 'mondraker'`), añade selectores específicos si el resultado genérico se queda corto (por ejemplo, si la web usa un configurador de talla/color que la extracción automática no detecta).
4. Guarda. No hace falta tocar nada más: el menú, el modal, el PDF, el Word y la descarga de fotos funcionan igual para todas las marcas.

Para una marca completamente nueva, añade una línea `// @match https://www.marca.com/*` al principio del archivo y una entrada nueva en `ADAPTERS` siguiendo el mismo patrón.

## 4. Cómo extrae los datos (para mantenimiento)

El extractor prioriza datos estructurados que casi todas las tiendas online incluyen para SEO (JSON-LD `schema.org/Product` y metaetiquetas Open Graph). Si no los encuentra, recurre a heurísticas: busca tablas o listas de dos columnas para las especificaciones, y busca imágenes dentro de galerías/carruseles para las fotos. En Trek, además, lee directamente los bloques `[qaid^="product-spec-bom-"]` de la web para obtener el nombre real de cada categoría de especificaciones (Conjunto del cuadro, Ruedas, etc.), en vez de un genérico "Especificaciones". Esto hace que funcione razonablemente bien en sitios nuevos sin configuración, aunque lo ideal es revisar y afinar cada adaptador la primera vez que se prueba contra una web real.

## 5. Solución de problemas

**Tras editar el script, la ficha sigue saliendo con datos antiguos (p. ej. "Precio distribuidor" en vez de PVPR, sin tabla de SKUs...):**

Trek es una SPA (Vue): un simple F5 sobre una pestaña ya abierta puede seguir ejecutando la versión anterior del script en memoria, aunque Tampermonkey ya tenga guardada la nueva. Solución:

1. **Cierra del todo** la pestaña de Trek (no solo refrescar) y ábrela de nuevo desde cero.
2. Comprueba el build activo pasando el ratón por encima del botón "📋 Extraer ficha" (tooltip), mirando la consola del navegador (se imprime al cargar la página), o en el pie del modal: debe coincidir con el `@version` del script (`1.9.0`).
3. Si sigue sin coincidir, revisa en el panel de control de Tampermonkey que no haya más de una entrada del script activa.

**El botón "Descargar fotos" no aparece:**

Solo aparece si la extracción detectó al menos una foto en la página. Si la ficha no tiene fotos (o no se detectaron), el botón se omite.

**El navegador pregunta si quiero permitir varias descargas a la vez:**

Es normal la primera vez que se usa "Descargar fotos" con muchas imágenes: acepta el permiso de "descargas múltiples" para ese sitio y las siguientes fotos se descargarán sin volver a preguntar.
