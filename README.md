
# Ficha de Bicicletas — extractor de fichas técnicas (v1.9.0)

Userscript de Tampermonkey que convierte la página de producto de una bicicleta (Trek, con adaptadores preparados para Orbea y Mondraker) en una ficha comercial profesional descargable en PDF y Word, con un solo clic. No depende de ningún servicio externo ni de IA en tiempo de ejecución: todo el procesamiento ocurre en el propio navegador.

## Qué hace

En cualquier ficha de producto de `trekbikes.com` aparece un botón flotante **"📋 Extraer ficha"**. Al pulsarlo:

1. Extrae del DOM de la página: marca, modelo, SKU, PVP recomendado (PVPR), talla y color del SKU mostrado, descripción, especificaciones técnicas completas (agrupadas por categoría real: Conjunto del cuadro, Ruedas, Transmisión, Sistema eléctrico...) y las fotos de la galería.
2. Extrae también, específicamente para Trek, la tabla completa de SKUs disponibles (talla + color + código UPC/EAN) a partir de la cuadrícula de tallas/colores de la web.
3. Antes de generar nada, abre un **menú de configuración de la ficha** donde se elige:
   - qué apartados incluir (Especificaciones, Galería de fotos, Tabla de SKUs, Garantías);
   - si las garantías son para persona física o jurídica (texto legal distinto para cada caso);
   - el nombre del cliente destinatario;
   - un descuento sobre el PVP recomendado, en euros o en porcentaje.
4. Muestra una vista previa en pantalla con todo lo anterior ya aplicado (portada con foto, SKU, talla/color, cliente, PVP recomendado, descuento aplicado y precio final, más el logo de la empresa).
5. Permite descargar esa misma información como **PDF** o **Word** (mismo contenido, formato editable).
6. Permite además **descargar todas las fotos detectadas** de la ficha (no solo las 6 de la galería) directamente al PC, en `.jpg`, nombradas con el SKU: `{sku}.jpg`, `{sku}_1.jpg`, `{sku}_2.jpg`...

## Por qué existe

Sustituye el proceso manual de copiar datos y fotos de la web de la marca a un documento para enviar a clientes/distribuidores. Es una herramienta independiente (no un asistente de IA): una vez instalada, funciona sola, sin conexión a Claude ni a ningún otro servicio de terceros salvo las librerías de generación de PDF/Word (cargadas desde un CDN público).

## Arquitectura (por qué es fácil de mantener y ampliar)

- **Núcleo genérico**: sabe extraer datos de *cualquier* página de producto de e-commerce usando estándares (JSON-LD `schema.org/Product`, metaetiquetas Open Graph) y heurísticas (tablas de especificaciones, galerías de imágenes). Esto es lo que hace que, sin escribir código específico, ya funcione razonablemente bien en marcas nuevas.
- **Adaptadores por marca**: pequeñas funciones (una por marca) que llaman al núcleo genérico y solo afinan lo que esa web hace de forma distinta. Trek, por ejemplo, necesita lógica propia para diferenciar el PVP recomendado del precio de distribuidor, para leer su cuadrícula de tallas/colores, y para leer los títulos reales de cada grupo de especificaciones. Añadir una marca nueva (p. ej. Orbea) es escribir un adaptador pequeño siguiendo el mismo patrón — el resto (menú, vista previa, PDF, Word, descarga de fotos) ya funciona igual para todas.
- **Contenido de garantías**: bloque de texto legal estructurado (física / jurídica) que se reutiliza tal cual en la vista previa, el PDF y el Word, para garantizar que el texto es idéntico en los tres sitios.
- **Generación de documentos**: PDF con jsPDF + jspdf-autotable; Word con html-docx-js (conversión HTML → docx), elegido tras comprobar que la librería `docx.js` se quedaba colgada de forma indefinida en el entorno de Tampermonkey.
- **Descarga de fotos**: reutiliza el mismo pipeline de descarga/redimensionado de imágenes (vía GM_xmlhttpRequest, con relleno de fondo blanco para fotos con transparencia) que ya usa la ficha, pero aplicado a todas las fotos detectadas en la página, no solo a las 6 que entran en la galería del PDF/Word.

Los detalles paso a paso de instalación, uso y cómo añadir una marca están en `INSTALACION.md`.

## Estado

Probado en vivo contra la web B2B de Trek (`trekbikes.com/b2b/...`). Los adaptadores de Orbea y Mondraker son, de momento, solo el motor genérico con la marca fijada — funcionan pero no se han afinado contra esas webs reales todavía.

## Distribución y actualizaciones

El script se autoactualiza en todos los equipos donde esté instalado apuntando a este mismo repositorio (ver sección "Publicar en GitHub" de `INSTALACION.md`): basta con subir aquí la versión más reciente y Tampermonkey la detecta sola, sin volver a copiar/pegar nada a mano.
