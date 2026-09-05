// Descarga los PDF (OP y RMD) de un lote directamente desde el navegador,
// sin instalar nada: ni Node, ni Playwright, ni el .bat. Corre dentro de la
// misma pestaña donde ya tienes SAP abierto y logueado, usando tu propia
// sesión — igual que hace APLICACION.bat, pero sin necesitar permisos de
// administrador en la PC ni un Chromium aparte.
//
// CÓMO USARLO
// -----------
// 1. Abre SAP (fiori.medifarma.com.pe) e inicia sesión como siempre.
// 2. Entra a la transacción "Reporte Sobre de Lote Digital" (la misma que
//    usa el .bat) hasta ver la pantalla con el campo para escribir el lote.
// 3. Abre la consola del navegador:
//      - PC: F12 (o clic derecho -> Inspeccionar) y pestaña "Console".
//      - Celular (Kiwi Browser u otro Chromium con soporte de extensiones,
//        o la consola remota de Chrome DevTools): igual, pestaña Console.
// 4. Pega todo este archivo en la consola y presiona Enter.
// 5. Te va a preguntar el/los lote(s) (con un cuadro de diálogo) y empieza
//    solo: busca, lee la rejilla de resultados y descarga cada PDF (OP y
//    RMD de cada etapa), organizados igual que deja APLICACION.bat —
//    Producto/Etapa/OP o RMD/lote_etapa_tipo.pdf — dentro de la carpeta de
//    Descargas del navegador (sólo en Chrome/Edge; en Firefox cae suelto).
//
// También puede guardarse como marcador (bookmarklet): crea un marcador
// nuevo y pega como URL "javascript:" seguido de todo este código sin
// saltos de línea. Al hacer clic en el marcador estando en la pantalla de
// SAP, hace lo mismo que pegarlo en la consola.
//
// POR QUÉ FUNCIONA EN CUALQUIER PC SIN PERMISOS DE ADMINISTRADOR
// ----------------------------------------------------------------
// Esto es JavaScript que corre DENTRO de la pestaña del navegador que ya
// tienes abierta, usando tu sesión de SAP ya iniciada. No instala software,
// no abre otro navegador, no necesita Node ni Playwright: es exactamente lo
// mismo que hace la consola de "Inspeccionar elemento", que cualquier
// navegador trae de fábrica y cualquier usuario puede abrir sin ser
// administrador de la PC.

(async () => {
  const SEL_LOTE = ['input[title="Número de lote"]', 'input[title*="lote" i]'];
  const SEL_CONSULTA = ['[title="Ejecutar <objeto>"]', '*[id$="6:7"]'];
  // { nombre de columna en la rejilla -> carpeta del tipo de documento }.
  const TIPOS = [
    { nombre: "Producción-OP", carpeta: "OP" },
    { nombre: "Producción-RMD", carpeta: "RMD" },
  ];
  // Cl.Orden viene abreviado; se traduce al mismo nombre de etapa que usa
  // APLICACION.bat (nucleo.mjs), para que las carpetas coincidan con lo que
  // ya conoce la aplicación al analizarlas después.
  const ETAPAS = { ACON: "ACONDICIONADO", ENVS: "ENVASE", FABR: "FABRICACION" };
  // Tope de espera tras pulsar Consulta: no es un tiempo fijo, se comprueba
  // cada poco si la rejilla ya apareció (ver esperarRejilla). Este número es
  // sólo el límite antes de darse por vencido.
  const ESPERA_REJILLA_MS = 30000;
  const ESPERA_VISOR_MS = 12000;

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // La transacción vive dentro de un iframe de SAP GUI para HTML (WebGUI),
  // no en la página principal de Fiori. Se busca entre todos los iframes,
  // incluidos los anidados, el que tenga esa URL.
  function marcoSap() {
    const vistos = [window];
    for (let i = 0; i < vistos.length; i++) {
      const w = vistos[i];
      let doc;
      try {
        doc = w.document;
      } catch {
        continue; // otro origen: no es el nuestro, se ignora
      }
      if (/webgui/i.test(w.location.href)) return doc;
      for (const frame of doc.querySelectorAll("iframe")) {
        try {
          if (frame.contentWindow) vistos.push(frame.contentWindow);
        } catch {
          /* iframe de otro origen, se ignora */
        }
      }
    }
    return null;
  }

  function localizar(doc, selectores) {
    for (const sel of selectores) {
      const el = doc.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // Escribe letra por letra, como una persona, y termina con blur (salir
  // del campo). No basta con poner ".value" y avisar con "input"/"change":
  // eso pinta el texto en pantalla pero SAP GUI para HTML no siempre
  // actualiza con eso su copia interna del campo, la que de verdad viaja al
  // servidor al pulsar Consulta — y entonces la búsqueda sale vacía de
  // lote (por eso tardaba tanto: sin filtro, escaneaba todo). El blur es la
  // señal que usa para dar el campo por confirmado, igual que al pasar al
  // siguiente campo a mano.
  async function escribir(input, texto) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    input.focus();
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    for (const letra of texto) {
      const valorPrevio = input.value;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: letra, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keypress", { key: letra, bubbles: true }));
      setter.call(input, valorPrevio + letra);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: letra, bubbles: true }));
      await espera(30);
    }

    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await espera(300);
  }

  // Un ".click()" de JavaScript no siempre basta: SAP GUI para HTML escucha
  // la secuencia completa de eventos de mouse, no sólo el "click" final.
  function clicSap(el) {
    el.focus?.();
    for (const tipo of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window }));
    }
  }

  // ¿Sigue SAP procesando la consulta? El aviso de "cargando" puede vivir
  // dentro de la transacción (el indicador clásico de SAP GUI) o, si es el
  // propio shell de Fiori el que se pone a recargar, en la página de
  // arriba — por eso se miran los dos documentos, no sólo el de la
  // transacción.
  function ocupado(doc) {
    const enTransaccion = doc.querySelector(
      '[id*="BUSY" i], .sapUiLocalBusyIndicator, .lsBusyIndicator, [class*="Busy"]'
    );
    if (enTransaccion) return true;
    try {
      return document.querySelector('.sapUiLocalBusyIndicator, [class*="Busy"], .sapMDialog') !== null;
    } catch {
      return false;
    }
  }

  /** Espera activamente a que la rejilla de resultados aparezca. */
  async function esperarRejilla(doc, timeoutMs) {
    const limite = Date.now() + timeoutMs;
    let ultimoAviso = 0;
    while (Date.now() < limite) {
      const rejilla = leerRejilla(doc);
      if (rejilla) return rejilla;
      const transcurrido = timeoutMs - (limite - Date.now());
      if (transcurrido - ultimoAviso > 5000) {
        console.log(`     · esperando la rejilla… (${Math.round(transcurrido / 1000)} s, ${ocupado(doc) ? "SAP sigue ocupado" : "sin indicador de ocupado"})`);
        ultimoAviso = transcurrido;
      }
      await espera(400);
    }
    return null;
  }

  /** Deja un texto utilizable como nombre de carpeta. */
  function nombreSeguro(texto, porDefecto) {
    const limpio = String(texto || "")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return limpio || porDefecto;
  }

  function leerRejilla(doc) {
    const celdas = [...doc.querySelectorAll('[id^="grid#"]')];
    if (celdas.length === 0) return null;

    const partes = celdas[0].id.match(/^(grid#[^#]+#)(\d+),(\d+)$/);
    if (!partes) return null;
    const prefijo = partes[1];

    const cabecera = {};
    const filas = new Set();

    for (const c of celdas) {
      const m = c.id.match(/^grid#[^#]+#(\d+),(\d+)$/);
      if (!m) continue;
      const fila = Number(m[1]);
      const col = Number(m[2]);
      const texto = (c.innerText || c.textContent || "").trim();
      if (fila === 0) {
        if (texto) cabecera[texto] = col;
      } else {
        filas.add(fila);
      }
    }

    const leer = (fila, col) => {
      if (col === undefined) return "";
      const el = doc.getElementById(prefijo + fila + "," + col);
      return el ? (el.innerText || el.textContent || "").trim() : "";
    };

    // Celda con icono = documento cargado en SAP. Se comprueba antes de
    // pulsar, para no perder tiempo en huecos que de todos modos están
    // vacíos.
    const conIcono = (fila, col) => {
      if (col === undefined) return false;
      const el = doc.getElementById(prefijo + fila + "," + col);
      if (!el) return false;
      return el.querySelector('img, span[class*="icon"], a') !== null || el.innerHTML.trim().length > 0;
    };

    const datos = [...filas]
      .sort((a, b) => a - b)
      .map((fila) => ({
        fila,
        producto: nombreSeguro(leer(fila, cabecera["Texto breve de material"]), "PRODUCTO SIN NOMBRE"),
        etapa: nombreSeguro(
          ETAPAS[leer(fila, cabecera["Cl.Orden"])] || leer(fila, cabecera["Sección"]),
          "SIN ETAPA"
        ),
        iconos: Object.fromEntries(
          TIPOS.map(({ nombre }) => [nombre, conIcono(fila, cabecera[nombre])])
        ),
      }));

    return { prefijo, cabecera, datos };
  }

  function hayVisorAbierto(doc) {
    return doc.querySelector('embed[type*="pdf"], object[type*="pdf"], iframe[src*=".pdf"]') !== null;
  }

  async function cerrarVisor(doc) {
    if (!hayVisorAbierto(doc)) return true;
    const candidatos = ['button', '[title="Cancelar"]', '[title="Cerrar"]', '[title="Close"]'];
    for (const sel of candidatos) {
      for (const el of doc.querySelectorAll(sel)) {
        const texto = (el.innerText || el.title || "").trim().toUpperCase();
        if (sel === "button" && texto !== "OK") continue;
        el.click();
        await espera(700);
        if (!hayVisorAbierto(doc)) return true;
      }
    }
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await espera(700);
    return !hayVisorAbierto(doc);
  }

  // Encuentra la URL del PDF que acaba de abrirse en el visor incrustado
  // (SAP lo pone en un <embed>/<object>/<iframe>), en vez de interceptar
  // la respuesta de red como hace la versión de escritorio: un script en la
  // página no puede leer las respuestas de red de otros elementos, así que
  // se lee de dónde el propio visor cargó el archivo.
  function urlDelVisor(doc) {
    const el = doc.querySelector('embed[type*="pdf"], object[type*="pdf"], iframe[src*=".pdf"]');
    if (!el) return null;
    return el.src || el.data || null;
  }

  async function esperarVisor(doc, timeoutMs) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      const url = urlDelVisor(doc);
      if (url) return url;
      await espera(300);
    }
    return null;
  }

  function esPdfValido(buffer) {
    if (!buffer || buffer.byteLength < 5000) return false;
    const inicio = new TextDecoder("latin1").decode(buffer.slice(0, 5));
    if (inicio !== "%PDF-") return false;
    const final = new TextDecoder("latin1").decode(buffer.slice(-1500));
    return final.includes("%%EOF");
  }

  // "ruta" puede llevar barras (p. ej. "PRODUCTO/ETAPA/OP/archivo.pdf"):
  // Chrome y Edge crean esas subcarpetas dentro de Descargas al ver una
  // barra en el nombre de la descarga, igual que queda organizado
  // "descargas/" al usar APLICACION.bat. Firefox no lo hace — ahí el
  // archivo cae suelto en Descargas con el nombre completo (barras
  // incluidas convertidas a algo parecido a un guion bajo).
  function descargarArchivo(buffer, ruta) {
    const blob = new Blob([buffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ruta;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Busca un lote (rellena el campo, pulsa Consulta, lee la rejilla y baja
  // cada PDF) y devuelve lo guardado y lo que falló, para ese lote solo.
  async function descargarLote(lote) {
    const guardados = [];
    const fallos = [];

    let doc = marcoSap();
    if (!doc) {
      fallos.push(`${lote}: no encuentro la pantalla de SAP GUI en esta pestaña`);
      return { guardados, fallos };
    }

    const campo = localizar(doc, SEL_LOTE);
    if (!campo) {
      fallos.push(`${lote}: no encuentro el campo del lote`);
      return { guardados, fallos };
    }
    await escribir(campo, lote);
    console.log(`     · campo del lote: escribí "${lote}", quedó "${campo.value}"`);
    if (campo.value !== lote) {
      fallos.push(`${lote}: el campo no aceptó el valor (quedó "${campo.value}")`);
      return { guardados, fallos };
    }

    const boton = localizar(doc, SEL_CONSULTA);
    if (!boton) {
      fallos.push(`${lote}: no encuentro el botón Consulta`);
      return { guardados, fallos };
    }
    console.log(`     · botón Consulta encontrado: <${boton.tagName.toLowerCase()} id="${boton.id}">`);
    clicSap(boton);

    const rejilla = await esperarRejilla(doc, ESPERA_REJILLA_MS);
    doc = marcoSap() || doc;
    if (!rejilla) {
      fallos.push(
        `${lote}: la rejilla no apareció en ${Math.round(ESPERA_REJILLA_MS / 1000)} s` +
          (ocupado(doc) ? " (SAP seguía marcando ocupado)" : " (sin ningún indicador de que siga cargando — puede que el clic no haya llegado)")
      );
      return { guardados, fallos };
    }
    if (rejilla.datos.length === 0) {
      fallos.push(`${lote}: la búsqueda no devolvió ninguna etapa`);
      return { guardados, fallos };
    }

    const columnas = TIPOS.filter((t) => rejilla.cabecera[t.nombre] !== undefined);
    if (columnas.length === 0) {
      fallos.push(`${lote}: no encontré las columnas ${TIPOS.map((t) => t.nombre).join(" ni ")}`);
      return { guardados, fallos };
    }

    for (const fila of rejilla.datos) {
      for (const { nombre, carpeta: tipoCarpeta } of columnas) {
        const col = rejilla.cabecera[nombre];
        const rutaCarpeta = `${fila.producto}/${fila.etapa}/${tipoCarpeta}`;
        const archivo = `${lote}_${fila.etapa}_${tipoCarpeta}.pdf`;
        const ruta = `${rutaCarpeta}/${archivo}`;

        if (!fila.iconos[nombre]) {
          console.log(`     · ${ruta}: no está cargado en SAP`);
          continue;
        }

        doc = marcoSap() || doc;
        if (!(await cerrarVisor(doc))) {
          fallos.push(`${ruta}: no pude cerrar la ventana del visor anterior`);
          continue;
        }

        const celda = doc.getElementById(`${rejilla.prefijo}${fila.fila},${col}`);
        if (!celda) continue;
        clicSap(celda);

        const urlPdf = await esperarVisor(doc, ESPERA_VISOR_MS);
        if (!urlPdf) {
          console.log(`     · ${ruta}: no se abrió el PDF`);
          await cerrarVisor(doc);
          continue;
        }

        let buffer = null;
        try {
          const respuesta = await fetch(urlPdf, { credentials: "include" });
          buffer = await respuesta.arrayBuffer();
        } catch (err) {
          console.log(`     · ${ruta}: fallo al descargar (${err.message})`);
        }

        if (!esPdfValido(buffer)) {
          const kb = buffer ? Math.round(buffer.byteLength / 1024) : 0;
          fallos.push(`${ruta}: lo descargado no es un PDF válido (${kb} kB)`);
          await cerrarVisor(doc);
          continue;
        }

        descargarArchivo(buffer, ruta);
        guardados.push(ruta);
        console.log(`     · ${ruta} (${Math.round(buffer.byteLength / 1024)} kB)`);

        await cerrarVisor(doc);
        await espera(500);
      }
    }

    return { guardados, fallos };
  }

  // --------------------------------------------------------------- inicio ---

  const texto = window.prompt(
    "¿Qué lote(s) quieres descargar? Uno por línea, o separados por coma/espacio."
  );
  if (!texto) return;

  const lotes = [...new Set(texto.split(/[\s,;]+/).map((l) => l.trim()).filter(Boolean))];
  if (lotes.length === 0) return;

  const guardadosTotal = [];
  const fallosTotal = [];

  for (const lote of lotes) {
    console.log(`Lote ${lote}`);
    const { guardados, fallos } = await descargarLote(lote);
    guardadosTotal.push(...guardados);
    fallosTotal.push(...fallos);
    // Entre un lote y el siguiente conviene una pausa breve: la pantalla
    // necesita respirar antes de aceptar una nueva búsqueda.
    if (lotes.indexOf(lote) < lotes.length - 1) await espera(1000);
  }

  alert(
    `Listo. ${lotes.length} lote(s) procesado(s).\n\n` +
      `Guardados (${guardadosTotal.length}):\n${guardadosTotal.join("\n") || "ninguno"}` +
      (fallosTotal.length ? `\n\nCon problemas (${fallosTotal.length}):\n${fallosTotal.join("\n")}` : "")
  );
})();
