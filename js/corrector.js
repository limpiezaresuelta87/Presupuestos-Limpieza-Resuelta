/**
 * corrector.js
 * -----------------------------------------------------------------------
 * Corrector ortográfico propio (español) para avisar de palabras mal
 * escritas antes de guardar un presupuesto. No depende del corrector del
 * navegador (que no revisa mayúsculas ni funciona igual en todos lados):
 * usa nspell + un diccionario de español incluido en /vendor/, así que
 * anda igual en PC y celular, y sin internet.
 * Expuesto como window.Corrector.
 * -----------------------------------------------------------------------
 */

(function () {
  let promesaCarga = null;
  let spell = null;

  /** Descarga el diccionario una sola vez (queda en la caché de la app). */
  function cargar() {
    if (!promesaCarga) {
      const leer = function (url) {
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error('No se pudo cargar ' + url);
          return r.text();
        });
      };
      promesaCarga = Promise.all([leer('vendor/es.aff'), leer('vendor/es.dic')])
        .then(function (archivos) {
          spell = window.nspellLib(archivos[0], archivos[1]);
          return spell;
        });
      promesaCarga.catch(function () { promesaCarga = null; }); // permite reintentar después
    }
    return promesaCarga;
  }

  /** Minúsculas y sin tildes: para comparar contra la lista de palabras a ignorar. */
  function clave(palabra) {
    return String(palabra).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Devuelve la sugerencia con el mismo estilo de mayúsculas que la palabra original. */
  function adaptarMayusculas(sugerencia, original) {
    if (original.length > 1 && original === original.toUpperCase()) return sugerencia.toUpperCase();
    if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
      return sugerencia.charAt(0).toUpperCase() + sugerencia.slice(1);
    }
    return sugerencia;
  }

  /**
   * Revisa un texto. `ignorar` es un Set de palabras (ya pasadas por
   * clave()) que no se consideran errores: nombres de productos, marcas,
   * proveedores, clientes y las que la usuaria fue agregando.
   * Devuelve [{ palabra, sugerencias: [...] }] sin repetir palabras.
   */
  function revisarTexto(texto, ignorar) {
    if (!spell) return [];
    const vistas = {};
    const errores = [];
    (String(texto || '').match(/[\p{L}\p{N}]+/gu) || []).forEach(function (palabra) {
      if (palabra.length < 3 || /\d/.test(palabra)) return;
      const k = clave(palabra);
      if (vistas[k]) return;
      vistas[k] = true;
      if (ignorar && ignorar.has(k)) return;
      if (spell.correct(palabra.toLowerCase())) return;
      const sugerencias = spell.suggest(palabra.toLowerCase()).slice(0, 5)
        .map(function (s) { return adaptarMayusculas(s, palabra); });
      errores.push({ palabra: palabra, sugerencias: sugerencias });
    });
    return errores;
  }

  /** Reemplaza cada aparición exacta de `palabra` en `texto` por `nueva`. */
  function reemplazarPalabra(texto, palabra, nueva) {
    return String(texto).replace(/[\p{L}\p{N}]+/gu, function (p) { return p === palabra ? nueva : p; });
  }

  window.Corrector = {
    cargar: cargar,
    clave: clave,
    revisarTexto: revisarTexto,
    reemplazarPalabra: reemplazarPalabra,
  };
})();
