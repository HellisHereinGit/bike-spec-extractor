// ==UserScript==
// @name         Ficha de Bicicletas (Trek + adaptadores)
// @namespace    https://vadebicis.local/bike-spec-extractor
// @version      1.9.1
// @description  Extrae la ficha técnica y las fotos de una página de producto de bicicleta y la exporta a PDF y Word. Funciona en trekbikes.com y está preparado para añadir más marcas (Orbea, Mondraker...) mediante adaptadores.
// @author       Vadebicis
// @match        https://www.trekbikes.com/*
// @match        https://*.trekbikes.com/*
// @match        https://www.orbea.com/*
// @match        https://*.orbea.com/*
// @match        https://www.mondraker.com/*
// @match        https://*.mondraker.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=trekbikes.com
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// -----------------------------------------------------------------------
// AUTOACTUALIZACIÓN: sustituye <TU-USUARIO-GITHUB> y <TU-REPO> por los
// reales una vez creado el repositorio público en GitHub (ver README.md /
// INSTALACION.md). Con estas dos líneas, Tampermonkey comprueba solo si hay
// una versión más reciente y ofrece actualizar con un clic, en cualquier
// equipo donde esté instalado — sin volver a copiar/pegar el script.
// -----------------------------------------------------------------------
// @updateURL    https://raw.githubusercontent.com/HellisHereinGit/bike-spec-extractor/main/bike-spec-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/HellisHereinGit/bike-spec-extractor/main/bike-spec-extractor.user.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@2/dist/jspdf.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/jspdf-autotable@3/dist/jspdf.plugin.autotable.min.js
// @require      https://cdn.jsdelivr.net/npm/html-docx-js/dist/html-docx.js
// @run-at       document-idle
// ==/UserScript==

/* eslint-disable no-console */

/*
 * ============================================================================
 *  FICHA DE BICICLETAS — arquitectura del script
 * ============================================================================
 *
 *  1. NÚCLEO (no depende de ninguna marca): UI (botón + modal de vista previa),
 *     descarga de imágenes, generación de PDF y de Word.
 *
 *  2. EXTRACTOR GENÉRICO (genericExtract): intenta sacar toda la información
 *     posible de CUALQUIER página de producto usando datos estándar
 *     (JSON-LD schema.org/Product, meta tags Open Graph, y heurísticas de
 *     tablas de especificaciones / galerías de imágenes). Esto es lo que hace
 *     que el script funcione razonablemente bien en marcas nuevas sin escribir
 *     ni una línea de código específica.
 *
 *  3. ADAPTADORES POR MARCA: pequeñas funciones que llaman al extractor
 *     genérico y sólo afinan lo que ese sitio concreto hace de forma distinta
 *     (p. ej. Trek expone un `dataLayer` de analítica con el precio/nombre
 *     exactos). Si un adaptador falla, se cae automáticamente al genérico.
 *
 *  === CÓMO AÑADIR UNA MARCA NUEVA (p. ej. Orbea) ===
 *   a) Añade una línea `// @match  https://www.orbea.com/*` arriba.
 *   b) Añade una entrada al array ADAPTERS, por ejemplo:
 *        {
 *          id: 'orbea',
 *          matches: (host) => host.endsWith('orbea.com'),
 *          extract: async () => {
 *            const data = await genericExtract();
 *            data.brand = data.brand || 'Orbea';
 *            // aquí puedes afinar selectores específicos de orbea.com
 *            return data;
 *          },
 *        }
 *   c) Ya está: el resto (UI, PDF, Word) funciona igual para todas las marcas.
 * ============================================================================
 */

(function () {
  'use strict';

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log('[FichaBici]', ...args);

  // BUILD: sello de versión SIEMPRE visible (no depende de DEBUG). Sirve para
  // confirmar, sin ambigüedad, qué copia del script se está ejecutando de
  // verdad en la página (útil si Tampermonkey o el navegador sirven una
  // versión en caché tras editar el script). Súbelo cada vez que actualices
  // el fichero: si tras guardar y recargar la web ves el build ANTIGUO en la
  // consola, el problema es de caché del navegador/Tampermonkey, no del código.
  const BUILD = 'v1.9.1 · 2026-07-23 · maximo-6-fotos';
  console.log('%c[FichaBici] BUILD ' + BUILD, 'color:#b0281f;font-weight:bold;');

  // --------------------------------------------------------------------------
  // 0. ESTILOS
  // --------------------------------------------------------------------------
  GM_addStyle(`
    #bse-launcher {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483000;
      background: #16181d; color: #fff; border: none; border-radius: 999px;
      padding: 14px 20px; font: 600 14px/1.2 -apple-system, Segoe UI, Roboto, sans-serif;
      box-shadow: 0 6px 20px rgba(0,0,0,.35); cursor: pointer; display: flex;
      align-items: center; gap: 8px; transition: transform .15s ease;
    }
    #bse-launcher:hover { transform: translateY(-2px); }
    #bse-launcher[disabled] { opacity: .6; cursor: wait; }
    #bse-overlay {
      position: fixed; inset: 0; z-index: 2147483001; background: rgba(15,16,20,.6);
      display: flex; align-items: center; justify-content: center; padding: 24px;
      font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif;
    }
    #bse-modal {
      background: #fff; color: #16181d; width: min(880px, 100%); max-height: 88vh;
      overflow-y: auto; border-radius: 14px; padding: 28px 32px; position: relative;
      box-shadow: 0 20px 60px rgba(0,0,0,.4);
    }
    #bse-modal h1 { font-size: 22px; margin: 0 0 4px; }
    #bse-modal .bse-price { font-size: 17px; font-weight: 600; color: #b0281f; margin: 0 0 16px; }
    #bse-modal .bse-close {
      position: absolute; top: 16px; right: 16px; border: none; background: #eee;
      width: 32px; height: 32px; border-radius: 50%; font-size: 16px; cursor: pointer;
    }
    #bse-modal .bse-hero { width: 100%; max-height: 320px; object-fit: contain; border-radius: 8px; background: #f4f4f5; margin-bottom: 16px; }
    #bse-modal .bse-desc { white-space: pre-wrap; margin-bottom: 20px; color: #333; }
    #bse-modal h2 { font-size: 16px; margin: 22px 0 8px; border-bottom: 2px solid #eee; padding-bottom: 6px; }
    #bse-modal table.bse-spec-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 13px; }
    #bse-modal table.bse-spec-table td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    #bse-modal table.bse-spec-table td:first-child { font-weight: 600; width: 38%; color: #444; }
    #bse-modal .bse-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px,1fr)); gap: 8px; margin-bottom: 20px; }
    #bse-modal .bse-gallery img { width: 100%; height: 90px; object-fit: cover; border-radius: 6px; background: #f4f4f5; }
    #bse-modal .bse-actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
    #bse-modal .bse-actions button {
      flex: 1 1 160px; padding: 12px 16px; border-radius: 8px; border: none; cursor: pointer;
      font-weight: 600; font-size: 14px;
    }
    #bse-modal .bse-btn-pdf { background: #16181d; color: #fff; }
    #bse-modal .bse-btn-docx { background: #2b579a; color: #fff; }
    #bse-modal .bse-btn-photos { background: #2e7d32; color: #fff; }
    #bse-modal .bse-actions button[disabled] { opacity: .6; cursor: wait; }
    #bse-modal .bse-warning { background: #fff4e5; border: 1px solid #f0c36d; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
    #bse-modal .bse-source { font-size: 11px; color: #888; margin-top: 18px; word-break: break-all; }
    #bse-modal .bse-warranty h4 { font-size: 14px; margin: 18px 0 6px; }
    #bse-modal .bse-warranty h5 { font-size: 12.5px; margin: 12px 0 4px; color: #333; }
    #bse-modal .bse-warranty p { font-size: 12.5px; line-height: 1.5; margin: 0 0 8px; color: #333; }
    #bse-modal .bse-warranty ul { margin: 0 0 8px; padding-left: 20px; }
    #bse-modal .bse-warranty li { font-size: 12.5px; line-height: 1.5; margin-bottom: 4px; }
    #bse-modal .bse-warranty .bse-note { font-size: 11px; font-style: italic; color: #777; margin: -4px 0 8px; }
    /* Menú de selección de secciones (aparece justo tras extraer, antes de la vista previa) */
    #bse-menu-modal { background: #fff; color: #16181d; width: min(420px, 100%); border-radius: 14px; padding: 26px 28px; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
    #bse-menu-modal h1 { font-size: 18px; margin: 0 0 4px; }
    #bse-menu-modal p.bse-menu-sub { font-size: 13px; color: #666; margin: 0 0 18px; }
    #bse-menu-modal .bse-menu-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #eee; }
    #bse-menu-modal .bse-menu-row label { font-size: 14px; font-weight: 600; flex: 1; cursor: pointer; }
    #bse-menu-modal .bse-menu-row input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
    #bse-menu-modal .bse-menu-sub-row { display: none; padding: 6px 0 10px 28px; gap: 16px; font-size: 13px; }
    #bse-menu-modal .bse-menu-sub-row.bse-visible { display: flex; }
    #bse-menu-modal .bse-menu-sub-row label { font-weight: 400; display: flex; align-items: center; gap: 6px; cursor: pointer; }
    #bse-menu-modal .bse-menu-actions { display: flex; gap: 10px; margin-top: 22px; }
    #bse-menu-modal .bse-menu-actions button { flex: 1; padding: 12px 16px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; font-size: 14px; }
    #bse-menu-modal .bse-menu-confirm { background: #16181d; color: #fff; }
    #bse-menu-modal .bse-menu-cancel { background: #eee; color: #333; }
    #bse-menu-modal .bse-menu-field { padding: 12px 0; border-bottom: 1px solid #eee; }
    #bse-menu-modal .bse-menu-field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    #bse-menu-modal .bse-menu-field input[type="text"],
    #bse-menu-modal .bse-menu-field input[type="number"] { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
    #bse-menu-modal .bse-discount-row { display: flex; gap: 8px; }
    #bse-menu-modal .bse-discount-row input[type="number"] { flex: 1; }
    #bse-menu-modal .bse-discount-row select { padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
  `);

  // --------------------------------------------------------------------------
  // 1. UTILIDADES GENERALES
  // --------------------------------------------------------------------------

  function absUrl(url) {
    try { return new URL(url, location.href).href; } catch (e) { return null; }
  }

  function uniq(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  function shortenSourceUrl(url) {
    // Muchas webs con zona privada (p.ej. el B2B de Trek) repiten el código
    // de idioma dos veces seguidas en la ruta: ".../b2b/es/es_ES/...". Como
    // esas URLs no sirven de nada a quien no tenga acceso (piden login),
    // mostramos solo hasta ahí en vez de la ruta larga completa.
    if (!url) return url;
    const match = url.match(/^(.*?\/([a-z]{2,3})\/\2)(?:[_/].*)?$/i);
    return match ? match[1] : url;
  }

  function textOf(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function isPlaceholderUrl(url) {
    if (!url) return true;
    if (url.startsWith('data:')) return true; // base64 diminuto típico de "blur-up"/placeholder
    const lower = url.toLowerCase();
    if (/(placeholder|blank|1x1|spacer|transparent|lazy-load)/.test(lower)) return true;
    return false;
  }

  function bestSrcFromSrcset(srcset) {
    if (!srcset) return null;
    // OJO: NO se puede partir por comas a secas. Algunas CDNs (Cloudinary,
    // que es la que usa Trek en su galería) meten comas DENTRO de la propia
    // URL como separador de sus parámetros de imagen, sin espacio detrás
    // (p.ej. ".../f_auto,c_fill,ar_4:3,w_1080,q_auto/..."). El separador
    // real entre variantes del srcset sí lleva coma+espacio, así que
    // cortamos solo ahí para no trocear la URL por la mitad.
    const candidates = srcset
      .split(/,\s+/)
      .map((s) => s.trim().split(/\s+/))
      .filter((c) => c[0]);
    candidates.sort((a, b) => (parseFloat(a[1]) || 0) - (parseFloat(b[1]) || 0));
    const last = candidates[candidates.length - 1];
    return last ? absUrl(last[0]) : null;
  }

  function bestSrcFromImg(img) {
    // 1) Si el <img> vive dentro de un <picture>, el/los <source srcset> suelen
    //    llevar la variante grande de verdad (el <img> a veces solo es fallback).
    const picture = img.closest('picture');
    if (picture) {
      const sources = Array.from(picture.querySelectorAll('source'));
      for (const source of sources) {
        const url = bestSrcFromSrcset(source.getAttribute('srcset') || source.getAttribute('data-srcset'));
        if (url && !isPlaceholderUrl(url)) return url;
      }
    }

    // 2) Atributos típicos de librerías de "lazy loading": el src real suele ir
    //    aquí mientras `src`/`currentSrc` sólo tiene un placeholder borroso o gris.
    //    A veces estos atributos, pensados para una URL suelta, llevan en
    //    realidad "URL descriptor" pegado (p.ej. "...jpg 1920w"); lo limpiamos.
    const lazyAttrs = ['data-src', 'data-original', 'data-zoom-src', 'data-zoom-image', 'data-large', 'data-full-src', 'data-lazy-src', 'data-hires'];
    for (const attr of lazyAttrs) {
      const raw = img.getAttribute(attr);
      const cleaned = raw ? raw.trim().replace(/\s+\d+(?:\.\d+)?[wx]$/, '') : null;
      const url = cleaned ? absUrl(cleaned) : null;
      if (url && !isPlaceholderUrl(url)) return url;
    }

    // 3) srcset / data-srcset del propio <img>
    const srcsetUrl = bestSrcFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
    if (srcsetUrl && !isPlaceholderUrl(srcsetUrl)) return srcsetUrl;

    // 4) currentSrc / src como último recurso
    const fallback = absUrl(img.currentSrc || img.src || '');
    return isPlaceholderUrl(fallback) ? null : fallback;
  }

  function looksLikeIcon(url, img) {
    if (!url) return true;
    const lower = url.toLowerCase();
    if (/(icon|sprite|logo|favicon|placeholder|spinner|loader)/.test(lower)) return true;
    // OJO: si la imagen aún no ha terminado de cargar píxeles (típico con lazy
    // loading), naturalWidth vale 0 — eso NO significa que sea un icono, así
    // que solo descartamos por tamaño cuando sabemos que YA cargó.
    if (img && img.complete && img.naturalWidth > 0 && img.naturalWidth < 80) return true;
    return false;
  }

  function extractBackgroundImages(container) {
    // Algunos carruseles pintan las fotos como background-image de un <div>
    // en vez de usar <img>. Lo cubrimos aparte para no tener que barrer TODO
    // el documento (solo se llama sobre contenedores de galería/carrusel).
    const results = [];
    container.querySelectorAll('*').forEach((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      const match = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (match && match[1]) {
        const url = absUrl(match[1]);
        if (url && !isPlaceholderUrl(url) && !looksLikeIcon(url, null)) {
          results.push({ url, alt: el.getAttribute('aria-label') || '' });
        }
      }
    });
    return results;
  }

  // --------------------------------------------------------------------------
  // 2. JSON-LD (schema.org/Product) — la fuente más fiable cuando existe
  // --------------------------------------------------------------------------

  function readJsonLdProduct() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      try {
        const parsed = JSON.parse(s.textContent);
        const candidates = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
        for (const node of candidates) {
          const type = node && node['@type'];
          const types = Array.isArray(type) ? type : [type];
          if (types.includes('Product')) return node;
        }
      } catch (e) { /* JSON-LD mal formado: lo ignoramos */ }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // 3. HEURÍSTICA DE ESPECIFICACIONES (tablas y listas dt/dd genéricas)
  // --------------------------------------------------------------------------

  function looksLikeHeadingEl(el) {
    if (!el) return false;
    if (/^H[1-6]$/.test(el.tagName)) return true;
    const cls = (el.className || '').toString().toLowerCase();
    return /(title|heading|section-name|group-name|category-name|label)/.test(cls) && textOf(el).length > 0 && textOf(el).length < 60;
  }

  function nearestHeadingText(el) {
    let node = el.previousElementSibling;
    let hops = 0;
    while (node && hops < 12) {
      if (looksLikeHeadingEl(node)) return textOf(node);
      node = node.previousElementSibling;
      hops++;
    }
    // sube al padre y repite una vez (típico patrón: heading fuera del contenedor de la tabla)
    if (el.parentElement && el.parentElement !== document.body) {
      let p = el.parentElement.previousElementSibling;
      hops = 0;
      while (p && hops < 6) {
        if (looksLikeHeadingEl(p)) return textOf(p);
        p = p.previousElementSibling;
        hops++;
      }
      // o un heading DENTRO del propio padre, antes de la tabla/lista (p.ej.
      // <div><h3>Cuadro</h3><dl>...</dl></div>)
      const siblingHeading = Array.from(el.parentElement.children).find((c) => c !== el && looksLikeHeadingEl(c));
      if (siblingHeading) return textOf(siblingHeading);
    }
    return null;
  }

  function extractSpecsFromTables() {
    const groups = [];
    const seenRows = new Set();

    // a) tablas (2 columnas simples, o multi-columna tipo "talla S/M/L/XL")
    document.querySelectorAll('table').forEach((table) => {
      const trs = Array.from(table.querySelectorAll('tr'));
      if (!trs.length) return;
      const firstRowIsHeader = trs[0].querySelector('th') != null && trs.length > 1;
      const headerCells = firstRowIsHeader ? Array.from(trs[0].children).filter((c) => /^(TD|TH)$/.test(c.tagName)).map(textOf) : [];
      const dataRows = firstRowIsHeader ? trs.slice(1) : trs;
      const rows = [];
      dataRows.forEach((tr) => {
        const cells = Array.from(tr.children).filter((c) => /^(TD|TH)$/.test(c.tagName));
        if (cells.length < 2) return;
        const label = textOf(cells[0]);
        let value;
        if (cells.length === 2) {
          value = textOf(cells[1]);
        } else {
          // tabla multi-columna (p.ej. una fila por medida, una columna por talla)
          value = cells
            .slice(1)
            .map((c, i) => {
              const colName = headerCells[i + 1];
              const v = textOf(c);
              return colName ? `${colName}: ${v}` : v;
            })
            .filter(Boolean)
            .join(' · ');
        }
        const key = label + '::' + value;
        if (label && value && !seenRows.has(key)) {
          seenRows.add(key);
          rows.push({ label, value });
        }
      });
      if (rows.length >= 1) {
        groups.push({ category: nearestHeadingText(table) || 'Especificaciones', rows });
      }
    });

    // b) listas de definición dt/dd — se emparejan por POSICIÓN (no por
    //    nextElementSibling), porque algunos maquetados con CSS grid meten
    //    todos los <dt> seguidos de todos los <dd> en vez de alternarlos.
    document.querySelectorAll('dl').forEach((dl) => {
      const dts = Array.from(dl.querySelectorAll('dt'));
      const dds = Array.from(dl.querySelectorAll('dd'));
      const rows = [];
      if (dts.length && dts.length === dds.length) {
        dts.forEach((dt, i) => {
          const label = textOf(dt);
          const value = textOf(dds[i]);
          const key = label + '::' + value;
          if (label && value && !seenRows.has(key)) {
            seenRows.add(key);
            rows.push({ label, value });
          }
        });
      }
      if (rows.length >= 1) {
        groups.push({ category: nearestHeadingText(dl) || 'Especificaciones', rows });
      }
    });

    return groups;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findTabByText(patterns) {
    const norm = (s) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    const candidates = Array.from(document.querySelectorAll('button, a, [role="tab"], li'));
    for (const pattern of patterns) {
      const p = norm(pattern);
      const match = candidates.find((el) => {
        const text = norm(el.textContent);
        return text.length > 0 && text.length < 60 && (text === p || text.includes(p));
      });
      if (match) return match;
    }
    return null;
  }

  async function ensureSpecsTabOpen() {
    // Trek (y probablemente otras marcas) sólo monta el contenido de
    // "Especificaciones" en el DOM cuando se hace clic en esa pestaña. Si al
    // extraer no encontramos nada, intentamos abrirla nosotros solos.
    if (extractSpecsFromTables().length) return;
    const tab = findTabByText(['Especificaciones', 'Specifications', 'Specs', 'Especificações']);
    if (tab) {
      tab.click();
      await wait(600);
    }
  }

  // --------------------------------------------------------------------------
  // 4. HEURÍSTICA DE GALERÍA DE FOTOS
  // --------------------------------------------------------------------------

  function extractGalleryImages(limit = 14) {
    const priorityContainers = document.querySelectorAll(
      '[class*="gallery" i], [class*="carousel" i], [class*="slider" i], [class*="swiper" i], [id*="gallery" i], [data-testid*="gallery" i], picture'
    );
    const ordered = [];
    const pushImgsFrom = (root) => {
      root.querySelectorAll('img').forEach((img) => {
        const url = bestSrcFromImg(img);
        if (url && !looksLikeIcon(url, img)) ordered.push({ url, alt: img.alt || '' });
      });
    };
    priorityContainers.forEach(pushImgsFrom);
    priorityContainers.forEach((container) => {
      extractBackgroundImages(container).forEach((item) => ordered.push(item));
    });
    pushImgsFrom(document.body); // resto de la página como fallback/añadido

    const seen = new Set();
    const result = [];
    for (const item of ordered) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      result.push(item);
      if (result.length >= limit) break;
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // 5. EXTRACTOR GENÉRICO
  // --------------------------------------------------------------------------

  function extractPriceFallback() {
    // Respaldo genérico si no hay JSON-LD/meta con el precio: buscamos algún
    // elemento con "price" en la clase cuyo texto tenga pinta de importe.
    const candidates = document.querySelectorAll('[class*="price" i]');
    for (const el of candidates) {
      const text = textOf(el);
      if (text && text.length < 40 && /[€$£]|\bEUR\b|\bUSD\b|\bGBP\b/.test(text) && /\d/.test(text)) {
        return text;
      }
    }
    return null;
  }

  function extractSku(ld) {
    if (ld && ld.sku) return String(ld.sku);
    const metaSku = document.querySelector('meta[itemprop="sku"], meta[property="product:retailer_item_id"]');
    if (metaSku) return metaSku.getAttribute('content');
    // Heurística: un elemento cuyo texto sea literalmente "SKU: 12345",
    // "Referencia: 12345", "Código: 12345", etc.
    const candidates = document.querySelectorAll('dt, dd, span, div, li, td, p');
    for (const el of candidates) {
      const text = textOf(el);
      if (text.length > 60) continue;
      const match = text.match(/^(SKU|Referencia|Ref\.?|C[oó]digo|Item\s*#?|Art[ií]culo)\s*:?\s*([A-Z0-9][A-Z0-9\-_.]{2,20})$/i);
      if (match) return match[2];
    }
    return null;
  }

  async function genericExtract() {
    const ld = readJsonLdProduct();
    const metaContent = (name) => {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      return el ? el.getAttribute('content') : null;
    };

    const brand =
      (ld && ld.brand && (ld.brand.name || ld.brand)) ||
      metaContent('product:brand') ||
      null;

    const model =
      (ld && ld.name) ||
      metaContent('og:title') ||
      document.title ||
      null;

    let price = null;
    let currency = null;
    if (ld && ld.offers) {
      const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      if (offer) {
        price = offer.price || offer.lowPrice || null;
        currency = offer.priceCurrency || null;
      }
    }
    if (!price) price = metaContent('product:price:amount');
    if (!currency) currency = metaContent('product:price:currency');
    if (!price) price = extractPriceFallback();

    const sku = extractSku(ld);

    const description =
      (ld && ld.description) ||
      metaContent('og:description') ||
      metaContent('description') ||
      null;

    let images = [];
    if (ld && ld.image) {
      images = (Array.isArray(ld.image) ? ld.image : [ld.image]).map((u) => ({ url: absUrl(u), alt: model || '' }));
    }
    images = images.concat(extractGalleryImages());
    images = images.filter((im, i, arr) => im.url && arr.findIndex((x) => x.url === im.url) === i);
    // Solo nos interesan las 6 primeras fotos detectadas: es el límite que ya
    // usa la galería de la ficha, y así el botón "Descargar fotos" descarga
    // exactamente las mismas que aparecen en el PDF/Word, ni una más.
    images = images.slice(0, 6);

    // Algunos sitios (Trek incluido) sólo montan la sección de specs en el
    // DOM cuando se hace clic en su pestaña ("Especificaciones"). Si no
    // encontramos nada a la primera, intentamos abrirla nosotros solos.
    await ensureSpecsTabOpen();
    const specs = extractSpecsFromTables();

    return {
      brand,
      model,
      sku,
      skuSize: null, // talla del SKU concreto mostrado en portada (si se puede determinar)
      skuColor: null, // color del SKU concreto mostrado en portada (si se puede determinar)
      skuTable: [], // [{size, color, sku, upc}] — lo rellenan los adaptadores que sepan sacarlo (p.ej. Trek)
      price: price ? String(price) : null,
      currency,
      description,
      specs,
      images,
      sourceUrl: location.href,
      extractedAt: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // 6. ADAPTADORES POR MARCA
  //    Cada adaptador parte SIEMPRE del extractor genérico y sólo afina lo
  //    que necesite. Si algo falla, se captura y se devuelve el dato genérico.
  // --------------------------------------------------------------------------

  function extractTrekSpecs() {
    // La pestaña "Especificaciones" de Trek organiza cada categoría (Conjunto
    // del cuadro, Ruedas, Transmisión, Sistema eléctrico...) como un acordeón
    // (.pdl-collapse-item). El botón de cada acordeón lleva un atributo
    // qaid="product-spec-bom-{Categoría}Expanded" — mucho más fiable que
    // intentar adivinar el "heading más cercano" en el DOM (que aquí queda
    // varios niveles por encima del <dl> con los datos). El contenido de
    // cada acordeón (accesible vía aria-controls) contiene un <dl> con los
    // pares dato/valor de esa categoría.
    const headers = Array.from(document.querySelectorAll('[qaid^="product-spec-bom-"][aria-controls]'));
    const groups = [];
    headers.forEach((btn) => {
      const contentId = btn.getAttribute('aria-controls');
      const content = contentId ? document.getElementById(contentId) : null;
      if (!content) return;
      const dl = content.querySelector('dl');
      if (!dl) return;
      const dts = Array.from(dl.querySelectorAll('dt'));
      const dds = Array.from(dl.querySelectorAll('dd'));
      if (!dts.length || dts.length !== dds.length) return;
      const rows = [];
      dts.forEach((dt, i) => {
        const label = textOf(dt);
        const value = textOf(dds[i]);
        if (label && value) rows.push({ label, value });
      });
      if (!rows.length) return;
      const qaid = btn.getAttribute('qaid') || '';
      const fromQaid = qaid.replace(/^product-spec-bom-/, '').replace(/Expanded$/, '').trim();
      const category = fromQaid || textOf(btn) || 'Especificaciones';
      groups.push({ category, rows });
    });
    return groups;
  }

  function extractTrekPvpr() {
    // En la web B2B de Trek aparecen dos precios: "Precio distribuidor" (el
    // de compra al por mayor) y "PVP recomendado" (el de venta al público).
    // Queremos siempre este último, nunca el distribuidor. El texto suele
    // venir junto en una misma celda: "PVP recomendado 3.299,00 €".
    const candidates = document.querySelectorAll('td, div, span, dd, li');
    for (const el of candidates) {
      const text = textOf(el);
      if (text.length > 60) continue;
      const match = text.match(/PVP\s*recomendado\s*([\d.,]+\s?(?:€|EUR|\$|USD|£|GBP)?)/i);
      if (match && match[1]) return match[1].trim();
    }
    return null;
  }

  function extractTrekColorFromUrl() {
    // El texto visible en las muestras de color de Trek ("red_black",
    // "grey_greenvisibility"...) coincide exactamente con el parámetro
    // ?colorCode= de la URL, así que es más fiable cogerlo de ahí que
    // intentar detectar qué swatch está "seleccionado" en el DOM.
    try {
      const code = new URL(location.href).searchParams.get('colorCode');
      if (!code) return null;
      return code.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    } catch (e) {
      return null;
    }
  }

  function extractTrekColorForInput(input) {
    // Cada grupo de tallas/color es una sección plegable independiente
    // (.pdl-collapse-item), con una cabecera tipo "black Gloss Dark
    // Star/Matte Dark Web" (código interno + nombre bonito separados por
    // el primer espacio). Nos quedamos con el nombre bonito.
    const collapseItem = input.closest('.pdl-collapse-item') || input.closest('[class*="collapse" i]');
    if (!collapseItem) return null;
    const header = collapseItem.querySelector('.pdl-collapse-item__header, [class*="header" i]');
    if (!header) return null;
    const text = textOf(header);
    const match = text.match(/^(\S+)\s+(.+)$/);
    return match ? match[2].trim() : text || null;
  }

  function extractTrekSkuTable() {
    // En la zona de compra B2B, cada talla tiene un <input type="number"
    // data-sku="12345"> (el campo de cantidad a pedir). Su <tr> contiene el
    // texto "Sku 12345 ... Tallas S (rueda de 27,5") UPC/EAN 123456789...".
    const urlColor = extractTrekColorFromUrl();
    const rows = [];
    const seen = new Set();
    document.querySelectorAll('input[data-sku]').forEach((input) => {
      const sku = input.getAttribute('data-sku');
      if (!sku || seen.has(sku)) return;
      const tr = input.closest('tr');
      if (!tr) return;
      const rowText = textOf(tr);
      const sizeMatch = rowText.match(/Tallas?\s+(.+?)\s+UPC\s*\/?\s*EAN/i);
      const upcMatch = rowText.match(/UPC\s*\/?\s*EAN\s+(\S+)/i);
      // El color de CADA grupo (no siempre el de la URL, que es solo el
      // seleccionado arriba de la página).
      const color = extractTrekColorForInput(input) || urlColor;
      seen.add(sku);
      rows.push({
        size: sizeMatch ? sizeMatch[1].trim() : '',
        color: color || '',
        sku,
        upc: upcMatch ? upcMatch[1].trim() : '',
      });
    });
    return rows;
  }

  const ADAPTERS = [
    {
      id: 'trek',
      matches: (host) => host.endsWith('trekbikes.com'),
      extract: async () => {
        const data = await genericExtract();
        data.brand = data.brand || 'Trek';
        try {
          // Sustituye las especificaciones mal etiquetadas (todos los grupos
          // caían al texto genérico "Especificaciones") por las de los
          // acordeones reales de Trek, con el nombre de categoría correcto
          // (Conjunto del cuadro, Ruedas, Transmisión...). Conservamos los
          // grupos que YA tenían un título correcto (p.ej. "Tallas", la guía
          // de tallas, extraída por tabla y no por acordeón).
          const trekSpecs = extractTrekSpecs();
          if (trekSpecs.length) {
            const keepGeneric = (data.specs || []).filter((g) => g.category !== 'Especificaciones');
            data.specs = [...keepGeneric, ...trekSpecs];
          }
        } catch (e) {
          log('trek adapter: no se pudo leer specs con selectores dedicados', e);
        }
        try {
          // Trek usa un dataLayer de Google Analytics/Enhanced Ecommerce. En las
          // fichas de producto suele incluir el detalle exacto (nombre/precio/id).
          const layer = window.dataLayer || [];
          for (const entry of layer) {
            const products =
              (entry && entry.ecommerce && entry.ecommerce.detail && entry.ecommerce.detail.products) ||
              (entry && entry.ecommerce && entry.ecommerce.items) ||
              null;
            if (products && products[0]) {
              const p = products[0];
              if (p.name) data.model = p.name;
              if (p.price) { data.price = String(p.price); data.currency = data.currency || entry.ecommerce.currency || 'USD'; }
              // El id/sku del dataLayer suele ser el de la combinación talla+color
              // seleccionada en ese momento, que es justo lo que queremos en la portada.
              if (!data.sku && (p.id || p.sku)) data.sku = String(p.id || p.sku);
              break;
            }
          }
        } catch (e) {
          log('trek adapter: no se pudo leer dataLayer', e);
        }
        try {
          const skuTable = extractTrekSkuTable();
          if (skuTable.length) data.skuTable = skuTable;
          // El SKU de portada (data.sku) es el de la combinación talla+color
          // que se ve arriba de la página; lo cruzamos con la tabla para
          // saber exactamente qué talla y color le corresponden.
          if (data.sku) {
            const match = skuTable.find((r) => String(r.sku) === String(data.sku));
            if (match) {
              data.skuSize = match.size || null;
              data.skuColor = match.color || null;
            }
          }
        } catch (e) {
          log('trek adapter: no se pudo leer la tabla de tallas/SKU', e);
        }
        try {
          // El PVP recomendado tiene prioridad SIEMPRE sobre cualquier otro
          // precio que hayamos podido coger antes (dataLayer o heurística
          // genérica), porque esos suelen coincidir con el "Precio distribuidor".
          const pvpr = extractTrekPvpr();
          if (pvpr) {
            data.price = pvpr;
            data.currency = null; // el propio texto del PVPR ya trae el símbolo de moneda
          }
        } catch (e) {
          log('trek adapter: no se pudo leer el PVP recomendado', e);
        }
        return data;
      },
    },
    {
      id: 'orbea',
      matches: (host) => host.endsWith('orbea.com'),
      extract: async () => {
        const data = await genericExtract();
        data.brand = data.brand || 'Orbea';
        // TODO: cuando se pruebe contra orbea.com de verdad, afinar aquí
        // selectores específicos si el extractor genérico se queda corto
        // (por ejemplo su configurador de bici por talla/color).
        return data;
      },
    },
    {
      id: 'mondraker',
      matches: (host) => host.endsWith('mondraker.com'),
      extract: async () => {
        const data = await genericExtract();
        data.brand = data.brand || 'Mondraker';
        // TODO: mismo caso que Orbea, afinar cuando se pruebe en vivo.
        return data;
      },
    },
    {
      id: 'generic',
      matches: () => true,
      extract: genericExtract,
    },
  ];

  function getAdapter() {
    const host = location.hostname.replace(/^www\./, '');
    return ADAPTERS.find((a) => a.matches(host)) || ADAPTERS[ADAPTERS.length - 1];
  }

  // --------------------------------------------------------------------------
  // 6b. CONTENIDO DE GARANTÍAS (texto fijo aportado por el distribuidor, no se
  //     extrae de la web). Dos versiones: persona física y persona jurídica.
  //     Formato: array de bloques { type: 'h'|'h2'|'p'|'li'|'note', text }.
  //     'h' = título de sección, 'h2' = subtítulo, 'p' = párrafo normal,
  //     'li' = punto de una lista, 'note' = aclaración pequeña (p.ej. fechas).
  //     Se renderiza tanto a HTML (vista previa / Word) como a PDF a partir
  //     de esta MISMA fuente, para que ambos formatos digan siempre lo mismo.
  // --------------------------------------------------------------------------

  const WARRANTY_CONTENT = {
    fisica: [
      { type: 'h', text: 'Carbon Care' },
      { type: 'p', text: 'Queremos protegerte en todo momento, por lo que te facilitamos las cosas a la hora de cambiar un cuadro o una pieza de carbono que haya resultado dañada gracias al programa Trek Carbon Care. Carbon Care es un programa exclusivo que ofrece a los propietarios de una bicicleta Trek descuentos importantes a la hora de cambiar cuadros, horquillas y piezas de carbono que hayan resultado dañados.' },

      { type: 'h', text: 'Programa de fidelización de ruedas Carbon Care' },
      { type: 'p', text: 'El programa de fidelización de ruedas Carbon Care te da la tranquilidad de saber que estás cubierto por Trek y Bontrager. Somos conscientes de que las ruedas de carbono suponen una gran inversión, y este programa se ha diseñado para que te sientas completamente seguro a la hora de realizar tu compra.' },
      { type: 'h2', text: 'De por vida' },
      { type: 'p', text: 'Todas las ruedas de carbono Bontrager están protegidas por una garantía de por vida para el propietario original frente a defectos de fabricación y materiales. Esta garantía es aplicable a las ruedas compradas después del 1 de agosto de 2019 y a todas las bicicletas de la temporada 2020 y posteriores.' },
      { type: 'h2', text: 'Transcurridos los dos primeros años' },
      { type: 'p', text: 'Una vez transcurridos los dos años a partir de la fecha de compra original, ofrecemos importantes descuentos para la reparación o sustitución de las ruedas de carbono Bontrager dañadas.' },
      { type: 'p', text: 'El programa Carbon Care ofrece dos opciones y la resolución de la incidencia se determinará en función del modelo de rueda y de la gravedad del daño estructural.' },
      { type: 'li', text: 'La reparación de una rueda dañada estructuralmente (incluidos radios, pegatinas, cabecillas, y arandelas si son necesarias) y la reconstrucción en fábrica de los bujes originales.' },
      { type: 'li', text: 'La sustitución completa de la rueda.' },
      { type: 'note', text: '* La reparación y sustitución a través del programa de ruedas Carbon Care debe gestionarse a través de un distribuidor autorizado de Trek. Las tarifas son susceptibles de cambio sin previo aviso. Las tarifas de las reparaciones y la sustitución gratuita no incluyen los costes de envío de ida y vuelta al centro de reparación de ruedas Bontrager. Ponte en contacto con tu distribuidor de Trek para conocer el listado de ruedas cubiertas por este programa, la disponibilidad actual, las tarifas y los costes de envío.' },
      { type: 'p', text: 'Si tu rueda de carbono Bontrager sufre algún daño estructural durante los dos primeros años desde su compra mientras montas en bici, te la reemplazaremos o repararemos de forma gratuita*. Es así de fácil. Esta cobertura se aplica a las ruedas de carbono Bontrager que vienen de serie en las bicicletas, así como a las ruedas compradas a posteriori.' },

      { type: 'h', text: 'Crash Replacement (Sustitución por accidente)' },
      { type: 'p', text: 'Todos los cascos Trek y Bontrager vienen con cobertura Crash Replacement. Si tu casco sufre un impacto durante el primer año desde la fecha de compra, Trek te lo cambia gratis. Solo tienes que enviarnos el casco a portes pagados junto con una copia del ticket y una descripción del accidente. En cuanto recibamos el casco dañado, te enviaremos uno nuevo.' },

      { type: 'h', text: 'Garantía incondicional de 30 días' },
      { type: 'p', text: 'Si, por cualquier motivo, no quedas satisfecho con la compra de un producto Trek o Bontrager, podrás devolverlo, presentando el ticket de compra original, en la tienda donde lo compraste, en un plazo de 30 días, para cambiarlo por otro artículo o recuperar el importe. Es como si tuvieras 30 días de prueba. Esta garantía incluye componentes, ropa y accesorios Trek y Bontrager. No están incluidos los componentes Bontrager OE (equipamiento original) vendidos como parte de una bicicleta. Los productos usados han de limpiarse antes de su devolución. Si envías productos sin limpiar o lavar, te los devolveremos y los gastos correrán de tu cuenta.' },

      { type: 'h', text: 'Garantía Limitada Trek/Bontrager/Electra/Diamant' },
      { type: 'h2', text: 'Cuidamos de ti' },
      { type: 'p', text: 'Ofrecemos una garantía frente a defectos de fabricación o materiales en todos los productos tal y como se especifica a continuación.' },
      { type: 'h2', text: 'Empecemos por lo más importante' },
      { type: 'p', text: 'Ponte en contacto con un distribuidor o tienda autorizada para tramitar una incidencia de garantía. Es necesario presentar la factura legal de compra debidamente cumplimentada, incluyendo la descripción completa del producto, y para el caso de bicicletas o cuadros, su número de serie.' },
      { type: 'h2', text: 'GARANTIA DE LOS PRODUCTOS TREK (DICIEMBRE 2021)' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal con domicilio en la calle Ronda de Poniente 12 – 1º planta - 28760 Tres Cantos (Madrid), España (www.trekbikes.com/es/es_ES/contactUs/) garantiza sus productos desde la fecha de su primera adquisición en un concesionario autorizado de España con las siguientes garantías:' },
      { type: 'h2', text: 'GARANTÍA LEGAL' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal garantiza sus productos contra defectos de fabricación o materiales durante tres años (*) desde la fecha de su primera adquisición y ante la falta de conformidad conforme estipula la legislación vigente que resulta de aplicación.' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'h2', text: 'GARANTÍA COMERCIAL' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal garantiza durante toda su vida útil los cuadros de las bicicletas de la gama 2012 y siguientes así como a los productos distintos a los cuadros de bicicleta que se especifican expresamente a continuación, exclusivamente para el propietario original (solo para personas físicas, quedando excluidas las personas jurídicas y las entidades sin personalidad jurídica que no son beneficiarias de la presente GARANTIA COMERCIAL), y desde la fecha de su primera adquisición con las siguientes limitaciones / particularidades:' },
      { type: 'h2', text: 'Gama 2022 y siguientes' },
      { type: 'li', text: '1) Garantía de por vida exclusivamente para: cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono.' },
      { type: 'li', text: '2) Propiedad posterior: tres años de garantía para los propietarios posteriores (segundo o sucesivos - excepto aquellos cuadros y basculantes de los mismos que se hayan destinado a competición), exclusivamente para: cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono adquiridas después del 1 de agosto de 2019.' },
      { type: 'h2', text: 'Gamas 2020 y 2021' },
      { type: 'li', text: '1) Garantía de por vida exclusivamente para: cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono.' },
      { type: 'li', text: '2) Propiedad posterior: tres años de garantía para los propietarios posteriores (segundo o sucesivos - excepto aquellos cuadros y basculantes de los mismos que se hayan destinado a competición), exclusivamente para: cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono adquiridas después del 1 de agosto de 2019.' },
      { type: 'h2', text: 'Gamas 2012 a 2019' },
      { type: 'li', text: '1) Garantía de por vida exclusivamente para: cuadros rígidos (no se incluye la horquilla rígida); cuadro principal (no se incluye el basculante – vainas y tirantes - de los cuadros de doble suspensión).' },
      { type: 'li', text: '2) Garantía de cinco años exclusivamente para: los basculantes (vainas y tirantes) de los cuadros de las bicicletas de doble suspensión, excepto las familias SESSION, SCRATCH y SLASH.' },
      { type: 'li', text: '3) Garantía de tres años exclusivamente para: los cuadros y sus basculantes (vainas y tirantes) de las familias SESSION (ALUMINIO), SCRATCH, SLASH y TICKET.' },
      { type: 'li', text: '4) Quedan excluidos de la garantía comercial: los cuadros y sus basculantes (vainas y tirantes) de la familia SESSION (CARBONO), así como las horquillas rígidas.' },
      { type: 'h2', text: 'Gama 2012 y anteriores' },
      { type: 'p', text: 'Para los productos adquiridos antes del año 2012, ponte en contacto con nosotros directamente para conocer la cobertura de la garantía.' },
      { type: 'h2', text: 'LIMITACIONES APLICABLES A LA GARANTIA COMERCIAL' },
      { type: 'p', text: 'La garantía comercial se limita expresamente a la reparación o sustitución de un cuadro, y/o su basculante (vaina y tirantes) con defectos de fabricación o de materiales, TREK BICYCLE, S.L. Unipersonal se reserva el derecho a modificar la nomenclatura, el acabado, el color, la pintura y/o calcomanías del cuadro reparado o de sustitución, las reclamaciones se deben gestionar a través de un concesionario autorizado de la marca TREK que dará traslado de las mismas a TREK BICYCLE, S.L. Unipersonal, se requiere para ello la factura legal de la compra, así como que el mismo acredite su identidad mediante DNI, NIE o PASAPORTE.' },
      { type: 'p', text: 'El propietario de la bicicleta queda advertido que, debido a las mejoras introducidas en diseño y tecnología, el cuadro suministrado dentro del periodo de garantía comercial puede presentar problemas de compatibilidad con los componentes / piezas de su cuadro original. A título meramente enunciativo, que no limitativo, indicamos los siguientes: conjunto de pedalier, rodamientos de la dirección, bieleta (pieza que une los tirantes con el amortiguador), vainas, tirantes, amortiguador, reductores del amortiguador, así como la tornillería precisa para los mismos, guías de cables y tapas de duo – trap, ABP, etc. quedando TREK BICYCLE, S.L. Unipersonal exonerada de los costes derivados por la adquisición de los nuevos componentes / piezas precisas para el montaje, así como de los costes derivados del desmontaje de las piezas y componentes del cuadro original, y de su posterior montaje en el cuadro suministrado o reparado dentro del periodo de garantía comercial.' },
      { type: 'p', text: 'La presente garantía comercial no es de aplicación a los cuadros de bicicletas que se utilicen para actividades comerciales, como por ejemplo para su alquiler, demostraciones o flotas de cuerpos de seguridad.' },
      { type: 'p', text: 'La presente garantía comercial no afecta a los derechos legales de los consumidores y usuarios ante la falta de conformidad de los productos con el contrato siendo éstos independientes y compatibles con la garantía comercial.' },
      { type: 'h2', text: 'LIMITACIONES APLICABLES A LA GARANTIA LEGAL Y COMERCIAL' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal garantiza todos los componentes originales de sus bicicletas durante un periodo de tres años (*) desde la fecha de su primera adquisición (excepto todos aquellos sometidos a desgaste por su uso).' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'p', text: 'Las horquillas de suspensión, los amortiguadores y demás componentes de otros fabricantes, estarán cubiertos por la garantía de sus fabricantes originales – o, en su defecto - por sus distribuidores oficiales.' },
      { type: 'p', text: 'El acabado, la pintura y calcomanías de los cuadros de bicicleta cuentan con una garantía de tres años (*) desde la fecha de su primera adquisición contra defectos de fabricación y materiales, el propietario de la bicicleta queda advertido y ello supone una excepción a las garantías otorgadas, que la humedad, el sudor y otros agentes externos pueden provocar corrosión y que la exposición continuada a los rayos ultravioletas del sol deteriora las calcomanías y la pintura de las bicicletas, así como las de sus piezas y componentes.' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'p', text: 'En el caso de las bicicletas eléctricas, todo el sistema eléctrico, incluida la consola (controladora), el cargador, el motor, el cableado y el puerto de la batería cuentan con una garantía de tres años (*) desde la fecha de su primera adquisición, en este sentido se advierte que la batería de la bicicleta es un producto consumible sometido a desgaste por su uso y por tanto se encuentra garantizada durante tres años (*) desde la fecha de su primera adquisición o bien 600 ciclos de carga, lo que primero acontezca.' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'p', text: 'Las garantías otorgadas (legal y comercial) no cubren el deterioro por un uso o desgaste normales, un montaje o tareas de manteniendo inadecuadas, el desgaste de los rodamientos y casquillos de las bicicletas de doble suspensión, el desgaste de cualquier componente consumible (puños, cubiertas, cámaras, cadenas, cables, etc.) la instalación de piezas, accesorios o componentes no diseñados originalmente ni compatibles con la bicicleta vendida, daños producidos por accidentes o durante el transporte de la bicicleta por parte del usuario, un uso erróneo o negligente, así como la modificación o aplicación de pintura en el cuadro, horquilla, piezas y componentes; las garantías otorgadas no son un seguro a todo riesgo.' },
      { type: 'h2', text: 'Trek Carbon Care' },
      { type: 'p', text: 'Los accidentes, en ocasiones, son inevitables. Sabemos lo mucho que aprecias tu bicicleta Trek, y sabemos el inconveniente que supone tener que cambiar un cuadro o un componente dañado cuando no está cubierto por la garantía. Por este motivo, ofrecemos el Programa Trek Carbon Care (www.trekbikes.com/carbon_care/). Este programa permite obtener un descuento en la sustitución de un cuadro o componente en el caso de que los daños no estén cubiertos por la garantía.' },
    ],

    juridica: [
      { type: 'h', text: 'Garantía Limitada Trek/Bontrager/Electra/Diamant' },
      { type: 'h2', text: 'Cuidamos de ti' },
      { type: 'p', text: 'Ofrecemos una garantía frente a defectos de fabricación o materiales en todos los productos tal y como se especifica a continuación.' },
      { type: 'h2', text: 'Empecemos por lo más importante' },
      { type: 'p', text: 'Ponte en contacto con un distribuidor o tienda autorizada para tramitar una incidencia de garantía. Es necesario presentar la factura legal de compra debidamente cumplimentada, incluyendo la descripción completa del producto, y para el caso de bicicletas o cuadros, su número de serie.' },
      { type: 'h2', text: 'GARANTIA DE LOS PRODUCTOS TREK (DICIEMBRE 2021)' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal con domicilio en la calle Ronda de Poniente 12 – 1º planta - 28760 Tres Cantos (Madrid), España (www.trekbikes.com/es/es_ES/contactUs/) garantiza sus productos desde la fecha de su primera adquisición en un concesionario autorizado de España con las siguientes garantías:' },
      { type: 'h2', text: 'GARANTÍA LEGAL' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal garantiza sus productos contra defectos de fabricación o materiales durante tres años (*) desde la fecha de su primera adquisición y ante la falta de conformidad conforme estipula la legislación vigente que resulta de aplicación.' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'h2', text: 'GARANTÍA COMERCIAL' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal garantiza durante 3 años los cuadros de las bicicletas de la gama 2012 y siguientes así como a los productos distintos a los cuadros de bicicleta que se especifican expresamente a continuación, exclusivamente para el propietario original, y desde la fecha de su primera adquisición con las siguientes limitaciones / particularidades:' },
      { type: 'h2', text: 'Gama 2022 y siguientes' },
      { type: 'li', text: '1) Tres años de garantía para el propietario original (excepto aquellos cuadros y basculantes de los mismos que se hayan destinado a competición) para: cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono.' },
      { type: 'li', text: '2) Propiedad posterior: tres años de garantía para los propietarios posteriores (segundo o sucesivos - excepto aquellos cuadros y basculantes de los mismos que se hayan destinado a competición), exclusivamente para: cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono adquiridas después del 1 de agosto de 2019.' },
      { type: 'h2', text: 'Gamas 2020 y 2021' },
      { type: 'li', text: '1) Tres años de garantía para el propietario original (excepto aquellos cuadros y basculantes de los mismos que se hayan destinado a competición): cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono.' },
      { type: 'li', text: '2) Propiedad posterior: tres años de garantía para los propietarios posteriores (segundo o sucesivos - excepto aquellos cuadros y basculantes de los mismos que se hayan destinado a competición), exclusivamente para: cuadros rígidos (cuadro y horquilla rígida); cuadro principal y basculante (vainas y tirantes) de los cuadros de doble suspensión; ruedas Bontrager con llantas de carbono adquiridas después del 1 de agosto de 2019.' },
      { type: 'h2', text: 'Gamas 2012 a 2019' },
      { type: 'li', text: '1) Tres años de garantía para el propietario original (excepto aquellos cuadros y basculantes de los mismos que se hayan destinado a competición): cuadros rígidos (no se incluye la horquilla rígida); cuadro principal (no se incluye el basculante – vainas y tirantes - de los cuadros de doble suspensión).' },
      { type: 'li', text: '2) Garantía de cinco años exclusivamente para: los basculantes (vainas y tirantes) de los cuadros de las bicicletas de doble suspensión, excepto las familias SESSION, SCRATCH y SLASH.' },
      { type: 'li', text: '3) Garantía de tres años exclusivamente para: los cuadros y sus basculantes (vainas y tirantes) de las familias SESSION (ALUMINIO), SCRATCH, SLASH y TICKET.' },
      { type: 'li', text: '4) Quedan excluidos de la garantía comercial: los cuadros y sus basculantes (vainas y tirantes) de la familia SESSION (CARBONO), así como las horquillas rígidas.' },
      { type: 'h2', text: 'Gama 2012 y anteriores' },
      { type: 'p', text: 'Para los productos adquiridos antes del año 2012, ponte en contacto con nosotros directamente para conocer la cobertura de la garantía.' },
      { type: 'h2', text: 'LIMITACIONES APLICABLES A LA GARANTIA COMERCIAL' },
      { type: 'p', text: 'La garantía comercial se limita expresamente a la reparación o sustitución de un cuadro, y/o su basculante (vaina y tirantes) con defectos de fabricación o de materiales, TREK BICYCLE, S.L. Unipersonal se reserva el derecho a modificar la nomenclatura, el acabado, el color, la pintura y/o calcomanías del cuadro reparado o de sustitución, las reclamaciones se deben gestionar a través de un concesionario autorizado de la marca TREK que dará traslado de las mismas a TREK BICYCLE, S.L. Unipersonal, se requiere para ello la factura legal de la compra, así como que el mismo acredite su identidad mediante DNI, NIE o PASAPORTE.' },
      { type: 'p', text: 'El propietario de la bicicleta queda advertido que, debido a las mejoras introducidas en diseño y tecnología, el cuadro suministrado dentro del periodo de garantía comercial puede presentar problemas de compatibilidad con los componentes / piezas de su cuadro original. A título meramente enunciativo, que no limitativo, indicamos los siguientes: conjunto de pedalier, rodamientos de la dirección, bieleta (pieza que une los tirantes con el amortiguador), vainas, tirantes, amortiguador, reductores del amortiguador, así como la tornillería precisa para los mismos, guías de cables y tapas de duo – trap, ABP, etc. quedando TREK BICYCLE, S.L. Unipersonal exonerada de los costes derivados por la adquisición de los nuevos componentes / piezas precisas para el montaje, así como de los costes derivados del desmontaje de las piezas y componentes del cuadro original, y de su posterior montaje en el cuadro suministrado o reparado dentro del periodo de garantía comercial.' },
      { type: 'p', text: 'La presente garantía comercial no es de aplicación a los cuadros de bicicletas que se utilicen para actividades comerciales, como por ejemplo para su alquiler, demostraciones o flotas de cuerpos de seguridad.' },
      { type: 'p', text: 'La presente garantía comercial no afecta a los derechos legales de los consumidores y usuarios ante la falta de conformidad de los productos con el contrato siendo éstos independientes y compatibles con la garantía comercial.' },
      { type: 'h2', text: 'LIMITACIONES APLICABLES A LA GARANTIA LEGAL Y COMERCIAL' },
      { type: 'p', text: 'TREK BICYCLE, S.L. Unipersonal garantiza todos los componentes originales de sus bicicletas durante un periodo de tres años (*) desde la fecha de su primera adquisición (excepto todos aquellos sometidos a desgaste por su uso).' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'p', text: 'Las horquillas de suspensión, los amortiguadores y demás componentes de otros fabricantes, estarán cubiertos por la garantía de sus fabricantes originales – o, en su defecto - por sus distribuidores oficiales.' },
      { type: 'p', text: 'El acabado, la pintura y calcomanías de los cuadros de bicicleta cuentan con una garantía de tres años (*) desde la fecha de su primera adquisición contra defectos de fabricación y materiales, el propietario de la bicicleta queda advertido y ello supone una excepción a las garantías otorgadas, que la humedad, el sudor y otros agentes externos pueden provocar corrosión y que la exposición continuada a los rayos ultravioletas del sol deteriora las calcomanías y la pintura de las bicicletas, así como las de sus piezas y componentes.' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'p', text: 'En el caso de las bicicletas eléctricas, todo el sistema eléctrico, incluida la consola (controladora), el cargador, el motor, el cableado y el puerto de la batería cuentan con una garantía de tres años (*) desde la fecha de su primera adquisición, en este sentido se advierte que la batería de la bicicleta es un producto consumible sometido a desgaste por su uso y por tanto se encuentra garantizada durante tres años (*) desde la fecha de su primera adquisición o bien 600 ciclos de carga, lo que primero acontezca.' },
      { type: 'note', text: '(*) Dos años si la adquisición ha sido antes del 1 de enero de 2022.' },
      { type: 'p', text: 'Las garantías otorgadas (legal y comercial) no cubren el deterioro por un uso o desgaste normales, un montaje o tareas de manteniendo inadecuadas, el desgaste de los rodamientos y casquillos de las bicicletas de doble suspensión, el desgaste de cualquier componente consumible (puños, cubiertas, cámaras, cadenas, cables, etc.) la instalación de piezas, accesorios o componentes no diseñados originalmente ni compatibles con la bicicleta vendida, daños producidos por accidentes o durante el transporte de la bicicleta por parte del usuario, un uso erróneo o negligente, así como la modificación o aplicación de pintura en el cuadro, horquilla, piezas y componentes; las garantías otorgadas no son un seguro a todo riesgo.' },
    ],
  };

  function renderWarrantyBlocksHtml(blocks) {
    // Agrupa 'li' consecutivos en un único <ul>, y traduce el resto de tipos
    // a etiquetas HTML simples. Usado tanto en la vista previa como en Word.
    let html = '';
    let pendingList = [];
    const flushList = () => {
      if (pendingList.length) {
        html += `<ul>${pendingList.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
        pendingList = [];
      }
    };
    blocks.forEach((b) => {
      if (b.type === 'li') {
        pendingList.push(b.text);
        return;
      }
      flushList();
      if (b.type === 'h') html += `<h4>${escapeHtml(b.text)}</h4>`;
      else if (b.type === 'h2') html += `<h5>${escapeHtml(b.text)}</h5>`;
      else if (b.type === 'note') html += `<p class="bse-note">${escapeHtml(b.text)}</p>`;
      else html += `<p>${escapeHtml(b.text)}</p>`;
    });
    flushList();
    return html;
  }

  function addWarrantyToPdf(doc, blocks, margin, pageWidth, pageHeight, startY) {
    // Dibuja el bloque de garantías en el PDF, paginando manualmente (a
    // diferencia de las especificaciones, este texto no encaja en una tabla).
    let y = startY || margin;
    const ensureSpace = (needed) => {
      if (y + needed > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    };
    blocks.forEach((b) => {
      if (b.type === 'h') {
        ensureSpace(30);
        y += 10;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(0);
        doc.text(b.text, margin, y);
        y += 16;
      } else if (b.type === 'h2') {
        ensureSpace(22);
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(30);
        doc.text(b.text, margin, y);
        y += 13;
      } else if (b.type === 'note') {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(120);
        const lines = doc.splitTextToSize(b.text, pageWidth - margin * 2);
        ensureSpace(lines.length * 10 + 4);
        doc.text(lines, margin, y);
        y += lines.length * 10 + 6;
      } else {
        // 'p' y 'li' se pintan igual, con una pequeña sangría/viñeta para 'li'
        const indent = b.type === 'li' ? 12 : 0;
        const prefix = b.type === 'li' ? '• ' : '';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(40);
        const lines = doc.splitTextToSize(prefix + b.text, pageWidth - margin * 2 - indent);
        ensureSpace(lines.length * 11 + 6);
        doc.text(lines, margin + indent, y);
        y += lines.length * 11 + 6;
      }
    });
    doc.setTextColor(0);
  }

  // --------------------------------------------------------------------------
  // 7. DESCARGA Y PROCESADO DE IMÁGENES (para incrustarlas en PDF/Word)
  // --------------------------------------------------------------------------

  function fetchArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: 20000,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.response);
          else reject(new Error('HTTP ' + res.status + ' al descargar ' + url));
        },
        onerror: () => reject(new Error('Error de red al descargar ' + url)),
        ontimeout: () => reject(new Error('Timeout al descargar ' + url)),
      });
    });
  }

  async function processImage(url, maxDim = 1400) {
    const buf = await fetchArrayBuffer(url);
    const blob = new Blob([buf]);
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // JPEG no soporta transparencia: sin este relleno, las zonas transparentes
    // (habituales en PNG/AVIF) se convierten en negro al exportar. Rellenamos
    // de blanco antes de dibujar la imagen encima.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    const arrayBuffer = await jpegBlob.arrayBuffer();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(jpegBlob);
    });
    return { dataUrl, arrayBuffer, width: w, height: h, sourceUrl: url };
  }

  async function processImagesSafely(urls, maxDim) {
    const out = [];
    for (const url of urls) {
      try {
        out.push(await processImage(url, maxDim));
      } catch (e) {
        log('No se pudo procesar imagen', url, e);
      }
    }
    return out;
  }

  // Logo de la empresa distribuidora, mostrado en el pie de la ficha (PDF y
  // Word). Se descarga desde el repositorio de GitHub en el momento de
  // generar el documento (igual que las fotos de la bici), así que basta con
  // sustituir el archivo ahí para actualizar el logo en todos los equipos.
  const COMPANY_LOGO_URL = 'https://raw.githubusercontent.com/HellisHereinGit/documentos-de-apoyo/refs/heads/main/LOGO_VADE.jpg';

  async function getCompanyLogoAsset() {
    try {
      const [asset] = await processImagesSafely([COMPANY_LOGO_URL], 500);
      return asset || null;
    } catch (e) {
      log('No se pudo cargar el logo de empresa', e);
      return null;
    }
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Tiempo de espera agotado: ${label}`)), ms);
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); }
      );
    });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function safeFileName(data) {
    return `${data.brand || 'bici'}-${data.model || 'ficha'}`.replace(/[^\w\-]+/g, '_').slice(0, 80);
  }

  function jpegBlobFromDataUrl(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  async function downloadAllPhotos(data, onProgress) {
    // Descarga TODAS las fotos detectadas (no solo las 6 de la ficha),
    // nombradas con el SKU de la bici y numeradas: {sku}.jpg, {sku}_1.jpg,
    // {sku}_2.jpg... Si no hay SKU, usa el nombre de archivo genérico de la
    // ficha como base.
    const baseName = (data.sku ? String(data.sku) : safeFileName(data)).replace(/[^\w\-]+/g, '_').slice(0, 60) || 'foto';
    const urls = (data.images || []).map((im) => im.url).filter(Boolean);
    let done = 0;
    for (let i = 0; i < urls.length; i++) {
      try {
        const asset = await processImage(urls[i], 1600);
        const blob = jpegBlobFromDataUrl(asset.dataUrl);
        const filename = i === 0 ? `${baseName}.jpg` : `${baseName}_${i}.jpg`;
        triggerDownload(blob, filename);
      } catch (e) {
        log('No se pudo descargar la foto', urls[i], e);
      }
      done++;
      if (onProgress) onProgress(done, urls.length);
      // Pequeña pausa entre descargas: los navegadores pueden bloquear o pedir
      // permiso si se disparan muchas descargas seguidas sin ninguna espera.
      await wait(350);
    }
    return done;
  }

  // --------------------------------------------------------------------------
  // 7b. DESCUENTO SOBRE EL PVP (cliente + importe/porcentaje, tecleados por
  //     el distribuidor en el menú previo a la generación de la ficha)
  // --------------------------------------------------------------------------

  function parseEsNumber(str) {
    // Extrae el número de un texto de precio en formato español ("3.299,00 €"
    // -> 3299.00). El punto se usa como separador de miles y la coma como
    // decimal; si no hay coma pero sí varios puntos, se asume que todos son
    // separadores de miles (p.ej. "3.299" -> 3299, no 3.299).
    if (!str) return null;
    const match = String(str).match(/([\d.,]+)/);
    if (!match) return null;
    let numStr = match[1];
    if (numStr.includes(',')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if ((numStr.match(/\./g) || []).length > 1) {
      numStr = numStr.replace(/\./g, '');
    }
    const n = parseFloat(numStr);
    return isNaN(n) ? null : n;
  }

  function formatEsPrice(num) {
    // Formateo manual (no dependemos de Intl/toLocaleString) para garantizar
    // siempre "." como separador de miles y "," como decimal, sean cuales
    // sean el idioma/región configurados en el navegador.
    const fixed = num.toFixed(2);
    const [intPart, decPart] = fixed.split('.');
    const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${withThousands},${decPart}`;
  }

  function extractCurrencySuffix(data) {
    const fromPrice = data.price ? String(data.price).match(/[€$£]|EUR|USD|GBP/) : null;
    if (fromPrice) return fromPrice[0];
    return data.currency || '€';
  }

  function computeDiscount(data, discount) {
    // discount: { type: 'percent'|'amount', value: number } o null. Devuelve
    // null si no hay descuento válido o no se pudo interpretar el PVP.
    if (!discount || !discount.value || discount.value <= 0) return null;
    const base = parseEsNumber(data.price);
    if (base == null) return null;
    const currency = extractCurrencySuffix(data);
    let finalNum = discount.type === 'percent' ? base * (1 - discount.value / 100) : base - discount.value;
    if (finalNum < 0) finalNum = 0;
    const discountLabel = discount.type === 'percent' ? `${discount.value}%` : `${formatEsPrice(discount.value)} ${currency}`.trim();
    return {
      finalPriceText: `${formatEsPrice(finalNum)} ${currency}`.trim(),
      discountLabel,
    };
  }

  // --------------------------------------------------------------------------
  // 8. GENERACIÓN DE PDF (jsPDF + jspdf-autotable)
  // --------------------------------------------------------------------------

  async function buildPdf(data) {
    if (!window.jspdf) throw new Error('jsPDF no se cargó (revisa la consola / conexión a cdn.jsdelivr.net)');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    let y = margin + 18 * 5; // baja el título 5 líneas desde el borde superior

    // Qué apartados incluir (elegidos por el usuario en el menú previo). Si
    // por lo que sea no llega ninguna selección, se incluye todo salvo
    // garantías (comportamiento por defecto, igual que antes de tener menú).
    const sections = data.sections || { specs: true, gallery: true, skuTable: true, warranty: false, warrantyType: 'fisica' };

    const heroUrl = data.images[0] ? data.images[0].url : null;
    // La galería final incluye también la foto de portada (índice 0), no solo el resto.
    // Máximo 6 fotos en la galería final para que quepan en una sola página.
    const galleryUrls = sections.gallery ? data.images.slice(0, 6).map((im) => im.url) : [];
    const [heroAsset] = heroUrl ? await processImagesSafely([heroUrl], 1400) : [];
    const galleryAssets = sections.gallery ? await processImagesSafely(galleryUrls, 900) : [];
    const logoAsset = await getCompanyLogoAsset();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    const titleText = `${data.brand || ''} ${data.model || ''}`.trim() || 'Ficha de bicicleta';
    const titleLines = doc.splitTextToSize(titleText, pageWidth - margin * 2);
    doc.text(titleLines, margin, y + 6);
    y += titleLines.length * 26 + 6;

    if (data.sku) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`SKU: ${data.sku}`, margin, y);
      doc.setTextColor(0);
      y += 16;
    }

    if (data.skuSize || data.skuColor) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100);
      const parts = [data.skuSize ? `Talla: ${data.skuSize}` : '', data.skuColor ? `Color: ${data.skuColor}` : ''].filter(Boolean);
      doc.text(parts.join(' · '), margin, y);
      doc.setTextColor(0);
      y += 16;
    }

    if (data.clientName) {
      y += 16 * 3; // espaciado de 3 líneas por debajo de la talla/color
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text(`Cliente: ${data.clientName}`, margin, y);
      doc.setTextColor(0);
      y += 18 * 1.5; // interlineado x1.5 hasta la siguiente línea (PVP recomendado)
    }

    const discountResult = computeDiscount(data, data.discount);

    if (data.price) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(discountResult ? 11 : 14);
      if (discountResult) doc.setTextColor(100);
      else doc.setTextColor(176, 40, 31);
      doc.text(`${discountResult ? 'PVP recomendado: ' : ''}${data.price}${data.currency ? ' ' + data.currency : ''}`, margin, y);
      doc.setTextColor(0);
      y += discountResult ? 16 * 1.5 : 22;
    }

    if (discountResult) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Descuento aplicado: ${discountResult.discountLabel}`, margin, y);
      doc.setTextColor(0);
      y += 16 * 1.5;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(176, 40, 31);
      doc.text(`Tu precio final: ${discountResult.finalPriceText}`, margin, y);
      doc.setTextColor(0);
      y += 22;
    }

    if (heroAsset) {
      const maxW = pageWidth - margin * 2;
      const maxH = 260;
      const ratio = Math.min(maxW / heroAsset.width, maxH / heroAsset.height, 1);
      const w = heroAsset.width * ratio;
      const h = heroAsset.height * ratio;
      const x = margin + (maxW - w) / 2; // centrada horizontalmente en el área de contenido
      doc.addImage(heroAsset.dataUrl, 'JPEG', x, y, w, h);
      y += h + 18;
    }

    if (data.description) {
      doc.setFontSize(11);
      const lines = doc.splitTextToSize(data.description, pageWidth - margin * 2).slice(0, 20);
      doc.text(lines, margin, y);
      y += lines.length * 13 + 10;
    }

    if (logoAsset) {
      const logoH = 24;
      const logoW = logoAsset.width * (logoH / logoAsset.height);
      // Centrado dentro de la mitad DERECHA de la página (no de la página entera).
      const rightHalfX = pageWidth / 2;
      const logoX = rightHalfX + (pageWidth / 2 - logoW) / 2;
      doc.addImage(logoAsset.dataUrl, 'JPEG', logoX, pageHeight - 46, logoW, logoH);
    }

    doc.setFontSize(9);
    doc.setTextColor(130);
    doc.text(`Fuente: ${shortenSourceUrl(data.sourceUrl)}`, margin, pageHeight - 18);
    doc.setTextColor(0);

    if (sections.specs && data.specs && data.specs.length) {
      doc.addPage();
      let cursorY = margin;
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Especificaciones', margin, cursorY);
      cursorY += 14;

      data.specs.forEach((group) => {
        if (cursorY > pageHeight - 120) {
          doc.addPage();
          cursorY = margin;
        }
        doc.autoTable({
          startY: cursorY,
          margin: { left: margin, right: margin },
          head: [[group.category || 'General', '']],
          body: group.rows.map((r) => [r.label, r.value]),
          theme: 'striped',
          headStyles: { fillColor: [22, 24, 29] },
          styles: { fontSize: 9, cellPadding: 5 },
        });
        cursorY = doc.lastAutoTable.finalY + 18;
      });
    }

    if (galleryAssets.length) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Galería de fotos', margin, margin);
      let gx = margin;
      let gy = margin + 24;
      const cellW = (pageWidth - margin * 2 - 10) / 2;
      const cellH = 160;
      galleryAssets.forEach((asset, i) => {
        if (gy + cellH > pageHeight - margin) {
          doc.addPage();
          gx = margin;
          gy = margin;
        }
        const ratio = Math.min(cellW / asset.width, cellH / asset.height, 1);
        const w = asset.width * ratio;
        const h = asset.height * ratio;
        doc.addImage(asset.dataUrl, 'JPEG', gx, gy, w, h);
        if (i % 2 === 0) {
          gx += cellW + 10;
        } else {
          gx = margin;
          gy += cellH + 14;
        }
      });
    }

    if (sections.skuTable && data.skuTable && data.skuTable.length) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Tallas y SKUs disponibles', margin, margin);
      doc.autoTable({
        startY: margin + 14,
        margin: { left: margin, right: margin },
        head: [['Talla', 'Color', 'SKU', 'UPC/EAN']],
        body: data.skuTable.map((r) => [r.size, r.color || '', r.sku, r.upc]),
        theme: 'striped',
        headStyles: { fillColor: [22, 24, 29] },
        styles: { fontSize: 9, cellPadding: 5 },
      });
    }

    if (sections.warranty) {
      doc.addPage();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Garantías', margin, margin);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120);
      doc.text(sections.warrantyType === 'juridica' ? 'Comprador: persona jurídica' : 'Comprador: persona física', margin, margin + 16);
      doc.setTextColor(0);
      const warrantyBlocks = WARRANTY_CONTENT[sections.warrantyType] || WARRANTY_CONTENT.fisica;
      addWarrantyToPdf(doc, warrantyBlocks, margin, pageWidth, pageHeight, margin + 34);
    }

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`${i} / ${totalPages}`, pageWidth - margin - 30, pageHeight - 14);
    }

    doc.save(`${safeFileName(data)}.pdf`);
  }

  // --------------------------------------------------------------------------
  // 9. GENERACIÓN DE WORD (html-docx-js)
  //    NOTA: se probó primero con la librería "docx" (docx.js), pero su
  //    Packer.toBlob() se quedaba colgado para siempre dentro del sandbox de
  //    Tampermonkey (confirmado incluso sin imágenes de por medio). En vez de
  //    seguir peleando con esa librería, generamos el Word a partir de HTML
  //    (igual que la vista previa), que es mucho más simple y no depende de
  //    generar un .zip de forma asíncrona.
  // --------------------------------------------------------------------------

  async function buildDocx(data) {
    if (!window.htmlDocx) throw new Error('html-docx-js no se cargó (revisa la consola / conexión a cdn.jsdelivr.net)');

    const sections = data.sections || { specs: true, gallery: true, skuTable: true, warranty: false, warrantyType: 'fisica' };
    const docxDiscountResult = computeDiscount(data, data.discount);

    const heroUrl = data.images[0] ? data.images[0].url : null;
    // La galería final incluye también la foto de portada (índice 0), no solo el resto.
    // Máximo 6 fotos en la galería final para que quepan en una sola página.
    const galleryUrls = sections.gallery ? data.images.slice(0, 6).map((im) => im.url) : [];
    const [heroAsset] = heroUrl ? await processImagesSafely([heroUrl], 1000) : [];
    const logoAsset = await getCompanyLogoAsset();
    const galleryAssets = sections.gallery ? await processImagesSafely(galleryUrls, 700) : [];

    // html-docx-js no respeta bien max-width por CSS en las imágenes (las
    // incrusta a su tamaño "natural"), así que fijamos width/height como
    // atributos HTML explícitos para que Word las muestre ya encajadas.
    const HERO_DISPLAY_WIDTH = 460;
    const THUMB_DISPLAY_WIDTH = 150;
    const imgTag = (asset, displayWidth, extraAttrs = '') => {
      const w = Math.min(displayWidth, asset.width);
      const h = Math.round(w * (asset.height / asset.width));
      return `<img src="${asset.dataUrl}" width="${w}" height="${h}" ${extraAttrs}>`;
    };

    const specsHtml = (data.specs || [])
      .map(
        (group) => `
          <h3>${escapeHtml(group.category || 'Especificaciones')}</h3>
          <table>${group.rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`).join('')}</table>
        `
      )
      .join('');

    const galleryHtml = galleryAssets.length
      ? `<h2>Galería de fotos</h2><div class="gallery">${galleryAssets
          .map((a) => imgTag(a, THUMB_DISPLAY_WIDTH, 'style="margin:4pt;"'))
          .join('')}</div>`
      : '';

    const skuTableHtml =
      sections.skuTable && data.skuTable && data.skuTable.length
        ? `<h2>Tallas y SKUs disponibles</h2>
           <table>
             <tr><td>Talla</td><td>Color</td><td>SKU</td><td>UPC/EAN</td></tr>
             ${data.skuTable.map((r) => `<tr><td>${escapeHtml(r.size)}</td><td>${escapeHtml(r.color || '')}</td><td>${escapeHtml(r.sku)}</td><td>${escapeHtml(r.upc)}</td></tr>`).join('')}
           </table>`
        : '';

    const warrantyHtml = sections.warranty
      ? `<h2>Garantías</h2>
         <p class="sku">Comprador: ${sections.warrantyType === 'juridica' ? 'persona jurídica' : 'persona física'}</p>
         ${renderWarrantyBlocksHtml(WARRANTY_CONTENT[sections.warrantyType] || WARRANTY_CONTENT.fisica)}`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Calibri, Arial, sans-serif; color: #16181d; }
  h1 { font-size: 26pt; margin-bottom: 4pt; }
  h2 { font-size: 16pt; margin-top: 20pt; border-bottom: 1px solid #ccc; padding-bottom: 4pt; }
  h3 { font-size: 12pt; margin-top: 12pt; margin-bottom: 4pt; }
  h4 { font-size: 12.5pt; margin-top: 14pt; margin-bottom: 4pt; }
  h5 { font-size: 11pt; margin-top: 10pt; margin-bottom: 3pt; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10pt; font-size: 10pt; }
  td { border: 1px solid #ddd; padding: 4pt 8pt; vertical-align: top; }
  td:first-child { font-weight: bold; width: 35%; }
  .price { color: #b0281f; font-size: 13pt; font-weight: bold; }
  .sku { font-size: 10pt; color: #555; }
  .meta { font-size: 8pt; color: #888; margin-top: 16pt; }
  .bse-note { font-size: 8.5pt; font-style: italic; color: #777; }
</style>
</head>
<body>
  <h1>${escapeHtml(((data.brand || '') + ' ' + (data.model || '')).trim() || 'Ficha de bicicleta')}</h1>
  ${data.sku ? `<p class="sku">SKU: ${escapeHtml(data.sku)}</p>` : ''}
  ${
    data.skuSize || data.skuColor
      ? `<p class="sku">${[
          data.skuSize ? `Talla: ${escapeHtml(data.skuSize)}` : '',
          data.skuColor ? `Color: ${escapeHtml(data.skuColor)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}</p>`
      : ''
  }
  ${data.clientName ? `<p class="sku" style="margin-top:3em;line-height:1.5;">Cliente: ${escapeHtml(data.clientName)}</p>` : ''}
  ${
    docxDiscountResult
      ? `<p class="sku" style="line-height:1.5;">PVP recomendado: ${escapeHtml(data.price)}${data.currency ? ' ' + escapeHtml(data.currency) : ''}</p>
         <p class="sku" style="line-height:1.5;">Descuento aplicado: ${escapeHtml(docxDiscountResult.discountLabel)}</p>
         <p class="price" style="line-height:1.5;">Tu precio final: ${escapeHtml(docxDiscountResult.finalPriceText)}</p>`
      : data.price
      ? `<p class="price">${escapeHtml(data.price)}${data.currency ? ' ' + escapeHtml(data.currency) : ''}</p>`
      : ''
  }
  ${heroAsset ? `<p style="text-align:center;">${imgTag(heroAsset, HERO_DISPLAY_WIDTH)}</p>` : ''}
  ${data.description ? `<p>${escapeHtml(data.description)}</p>` : ''}
  ${sections.specs && data.specs && data.specs.length ? `<h2>Especificaciones</h2>${specsHtml}` : ''}
  ${galleryHtml}
  ${skuTableHtml}
  ${warrantyHtml}
  ${
    logoAsset
      ? `<table style="width:100%;border:none;margin-top:20pt;"><tr>
           <td style="width:50%;border:none;padding:0;"></td>
           <td style="width:50%;border:none;padding:0;text-align:center;">${imgTag(logoAsset, 160)}</td>
         </tr></table>`
      : ''
  }
  <p class="meta">Fuente: ${escapeHtml(shortenSourceUrl(data.sourceUrl))}</p>
</body>
</html>`;

    // Vertical (retrato). El ancho de las imágenes ya está fijado en pt/px
    // explícitos (HERO_DISPLAY_WIDTH / THUMB_DISPLAY_WIDTH) para que quepan
    // sin salirse de los márgenes en este formato.
    const blob = htmlDocx.asBlob(html, { orientation: 'portrait' });
    triggerDownload(blob, `${safeFileName(data)}.docx`);
  }

  // --------------------------------------------------------------------------
  // 10. INTERFAZ: botón flotante + modal de vista previa
  // --------------------------------------------------------------------------

  function renderSpecsHtml(specs) {
    if (!specs || !specs.length) return '<p style="color:#888">No se han detectado especificaciones automáticamente en esta página.</p>';
    return specs
      .map(
        (group) => `
          <h2>${escapeHtml(group.category || 'Especificaciones')}</h2>
          <table class="bse-spec-table">
            ${group.rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`).join('')}
          </table>
        `
      )
      .join('');
  }

  function renderSkuTableHtml(skuTable) {
    if (!skuTable || !skuTable.length) return '';
    return `
      <h2>Tallas y SKUs disponibles</h2>
      <table class="bse-spec-table">
        <tr><td>Talla</td><td>Color</td><td>SKU</td><td>UPC/EAN</td></tr>
        ${skuTable
          .map((r) => `<tr><td>${escapeHtml(r.size)}</td><td>${escapeHtml(r.color || '')}</td><td>${escapeHtml(r.sku)}</td><td>${escapeHtml(r.upc)}</td></tr>`)
          .join('')}
      </table>
    `;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function closeModal() {
    const overlay = document.getElementById('bse-overlay');
    if (overlay) overlay.remove();
  }

  function showModal(data) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'bse-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    const sections = data.sections || { specs: true, gallery: true, skuTable: true, warranty: false, warrantyType: 'fisica' };
    const modalDiscountResult = computeDiscount(data, data.discount);

    const warning =
      !data.model || (!data.specs || !data.specs.length)
        ? `<div class="bse-warning">Algunos datos no se han podido detectar automáticamente (esto puede pasar si la página cambia de estructura). Revisa la ficha antes de exportarla.</div>`
        : '';

    overlay.innerHTML = `
      <div id="bse-modal">
        <button class="bse-close" title="Cerrar">✕</button>
        <h1>${escapeHtml(((data.brand || '') + ' ' + (data.model || '')).trim() || 'Ficha de bicicleta')}</h1>
        ${data.sku ? `<p style="color:#666;font-size:13px;margin:0 0 6px;">SKU: ${escapeHtml(data.sku)}</p>` : ''}
        ${
          data.skuSize || data.skuColor
            ? `<p style="color:#666;font-size:13px;margin:0 0 6px;">${[
                data.skuSize ? `Talla: ${escapeHtml(data.skuSize)}` : '',
                data.skuColor ? `Color: ${escapeHtml(data.skuColor)}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}</p>`
            : ''
        }
        ${data.clientName ? `<p style="color:#666;font-size:13px;margin:3em 0 6px;line-height:1.5;">Cliente: ${escapeHtml(data.clientName)}</p>` : ''}
        ${
          modalDiscountResult
            ? `<p style="color:#666;font-size:13px;margin:0 0 4px;line-height:1.5;">PVP recomendado: ${escapeHtml(data.price)}${data.currency ? ' ' + escapeHtml(data.currency) : ''}</p>
               <p style="color:#666;font-size:13px;margin:0 0 4px;line-height:1.5;">Descuento aplicado: ${escapeHtml(modalDiscountResult.discountLabel)}</p>
               <p class="bse-price" style="line-height:1.5;">Tu precio final: ${escapeHtml(modalDiscountResult.finalPriceText)}</p>`
            : data.price
            ? `<p class="bse-price">${escapeHtml(data.price)}${data.currency ? ' ' + escapeHtml(data.currency) : ''}</p>`
            : ''
        }
        ${warning}
        ${data.images[0] ? `<img class="bse-hero" src="${escapeHtml(data.images[0].url)}" alt="">` : ''}
        ${data.description ? `<p class="bse-desc">${escapeHtml(data.description)}</p>` : ''}
        ${sections.specs ? renderSpecsHtml(data.specs) : ''}
        ${
          sections.gallery && data.images.length > 1
            ? `<h2>Galería (${data.images.length} fotos)</h2>
               <div class="bse-gallery">${data.images
                 .slice(0, 6)
                 .map((im) => `<img src="${escapeHtml(im.url)}" alt="${escapeHtml(im.alt)}">`)
                 .join('')}</div>`
            : ''
        }
        ${sections.skuTable ? renderSkuTableHtml(data.skuTable) : ''}
        ${
          sections.warranty
            ? `<h2>Garantías</h2>
               <p style="color:#666;font-size:13px;margin:0 0 6px;">Comprador: ${sections.warrantyType === 'juridica' ? 'persona jurídica' : 'persona física'}</p>
               <div class="bse-warranty">${renderWarrantyBlocksHtml(WARRANTY_CONTENT[sections.warrantyType] || WARRANTY_CONTENT.fisica)}</div>`
            : ''
        }
        <div class="bse-actions">
          <button class="bse-btn-pdf">⬇ Descargar PDF</button>
          <button class="bse-btn-docx">⬇ Descargar Word</button>
          ${data.images && data.images.length ? `<button class="bse-btn-photos">⬇ Descargar fotos (${data.images.length})</button>` : ''}
        </div>
        <p class="bse-source">Fuente: ${escapeHtml(shortenSourceUrl(data.sourceUrl))}</p>
        <p class="bse-source" style="opacity:.5;">Build ${escapeHtml(BUILD)}</p>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.bse-close').addEventListener('click', closeModal);

    const pdfBtn = overlay.querySelector('.bse-btn-pdf');
    pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true;
      pdfBtn.textContent = 'Generando PDF…';
      try {
        await buildPdf(data);
      } catch (e) {
        console.error(e);
        alert('No se pudo generar el PDF: ' + e.message);
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.textContent = '⬇ Descargar PDF';
      }
    });

    const docxBtn = overlay.querySelector('.bse-btn-docx');
    docxBtn.addEventListener('click', async () => {
      docxBtn.disabled = true;
      docxBtn.textContent = 'Generando Word…';
      try {
        await buildDocx(data);
      } catch (e) {
        console.error(e);
        alert('No se pudo generar el Word: ' + e.message);
      } finally {
        docxBtn.disabled = false;
        docxBtn.textContent = '⬇ Descargar Word';
      }
    });

    const photosBtn = overlay.querySelector('.bse-btn-photos');
    if (photosBtn) {
      const originalPhotosText = photosBtn.textContent;
      photosBtn.addEventListener('click', async () => {
        photosBtn.disabled = true;
        try {
          await downloadAllPhotos(data, (done, total) => {
            photosBtn.textContent = `Descargando ${done}/${total}…`;
          });
        } catch (e) {
          console.error(e);
          alert('No se pudieron descargar las fotos: ' + e.message);
        } finally {
          photosBtn.disabled = false;
          photosBtn.textContent = originalPhotosText;
        }
      });
    }
  }

  function showSectionsMenu(data) {
    // Menú previo a la vista previa: elige qué apartados incluir en la ficha
    // final (especificaciones —que ya incluyen la guía de tallas—, galería,
    // tabla de SKUs y garantías). Solo se muestran las casillas de las
    // secciones para las que realmente hay contenido disponible.
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'bse-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    const hasSpecs = !!(data.specs && data.specs.length);
    const hasGallery = data.images && data.images.length > 1;
    const hasSkuTable = !!(data.skuTable && data.skuTable.length);

    const row = (id, label, checked, available) =>
      available
        ? `<div class="bse-menu-row">
             <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
             <label for="${id}">${escapeHtml(label)}</label>
           </div>`
        : '';

    overlay.innerHTML = `
      <div id="bse-menu-modal">
        <h1>¿Qué incluye la ficha?</h1>
        <p class="bse-menu-sub">Elige los apartados que quieres exportar en el PDF/Word.</p>
        ${row('bse-chk-specs', 'Especificaciones (incluye guía de tallas)', true, hasSpecs)}
        ${row('bse-chk-gallery', 'Galería de fotos', true, hasGallery)}
        ${row('bse-chk-skutable', 'Tabla de SKUs', true, hasSkuTable)}
        <div class="bse-menu-row">
          <input type="checkbox" id="bse-chk-warranty">
          <label for="bse-chk-warranty">Garantías del fabricante</label>
        </div>
        <div class="bse-menu-sub-row" id="bse-warranty-sub">
          <label><input type="radio" name="bse-warranty-type" value="fisica" checked> Persona física</label>
          <label><input type="radio" name="bse-warranty-type" value="juridica"> Persona jurídica</label>
        </div>

        <div class="bse-menu-field">
          <label for="bse-client-name">Cliente (opcional)</label>
          <input type="text" id="bse-client-name" placeholder="Nombre del cliente destinatario">
        </div>

        <div class="bse-menu-field">
          <label for="bse-discount-value">Descuento sobre el PVP (opcional)</label>
          <div class="bse-discount-row">
            <input type="number" id="bse-discount-value" min="0" step="0.01" placeholder="0">
            <select id="bse-discount-type">
              <option value="percent">%</option>
              <option value="amount">€</option>
            </select>
          </div>
        </div>

        <div class="bse-menu-actions">
          <button class="bse-menu-cancel">Cancelar</button>
          <button class="bse-menu-confirm">Continuar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const warrantyChk = overlay.querySelector('#bse-chk-warranty');
    const warrantySub = overlay.querySelector('#bse-warranty-sub');
    warrantyChk.addEventListener('change', () => {
      warrantySub.classList.toggle('bse-visible', warrantyChk.checked);
    });

    overlay.querySelector('.bse-menu-cancel').addEventListener('click', closeModal);

    overlay.querySelector('.bse-menu-confirm').addEventListener('click', () => {
      const specsChk = overlay.querySelector('#bse-chk-specs');
      const galleryChk = overlay.querySelector('#bse-chk-gallery');
      const skuChk = overlay.querySelector('#bse-chk-skutable');
      const warrantyType = overlay.querySelector('input[name="bse-warranty-type"]:checked');
      data.sections = {
        specs: hasSpecs && !!(specsChk && specsChk.checked),
        gallery: hasGallery && !!(galleryChk && galleryChk.checked),
        skuTable: hasSkuTable && !!(skuChk && skuChk.checked),
        warranty: !!warrantyChk.checked,
        warrantyType: warrantyType ? warrantyType.value : 'fisica',
      };

      const clientNameInput = overlay.querySelector('#bse-client-name');
      data.clientName = clientNameInput && clientNameInput.value.trim() ? clientNameInput.value.trim() : null;

      const discountValueInput = overlay.querySelector('#bse-discount-value');
      const discountTypeSelect = overlay.querySelector('#bse-discount-type');
      const rawDiscount = discountValueInput ? String(discountValueInput.value).replace(',', '.').trim() : '';
      const discountValue = rawDiscount ? parseFloat(rawDiscount) : 0;
      data.discount = discountValue > 0 ? { type: discountTypeSelect.value, value: discountValue } : null;

      showModal(data);
    });
  }

  async function runExtraction(button) {
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '⏳ Extrayendo…';
    try {
      const adapter = getAdapter();
      log('Usando adaptador:', adapter.id);
      const data = await adapter.extract();
      showSectionsMenu(data);
    } catch (e) {
      console.error(e);
      alert('No se pudo extraer la ficha de esta página: ' + e.message);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function injectButton() {
    if (document.getElementById('bse-launcher')) return;
    const btn = document.createElement('button');
    btn.id = 'bse-launcher';
    btn.textContent = '📋 Extraer ficha';
    btn.title = 'Build ' + BUILD; // pasa el ratón por encima para confirmar la versión activa
    btn.addEventListener('click', () => runExtraction(btn));
    document.body.appendChild(btn);
  }

  // --------------------------------------------------------------------------
  // 11. ARRANQUE (con soporte para sitios de una sola página / navegación SPA)
  // --------------------------------------------------------------------------

  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    injectButton();
  }

  boot();

  // Trek (y probablemente Orbea/Mondraker) son SPA: la URL cambia sin recargar
  // la página. Vigilamos la URL para asegurarnos de que el botón sigue
  // disponible tras navegar de una bici a otra.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      closeModal();
      injectButton();
    }
  }, 1000);
})();
