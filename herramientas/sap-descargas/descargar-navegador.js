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
// 5. Te va a preguntar el/los lote(s) y empieza solo: busca, lee la rejilla
//    de resultados y baja cada PDF (OP y RMD de cada etapa).
//
// EN CUALQUIER CASO LOS ARCHIVOS QUEDAN ORGANIZADOS igual que deja
// APLICACION.bat — Producto / Etapa / OP o RMD / lote_etapa_tipo.pdf. Hay
// dos caminos para conseguirlo, y el script usa el que se pueda:
//
//   a) Si pulsas el botón azul de arriba a la derecha y eliges una carpeta,
//      los PDF se escriben directamente ahí, ya ordenados en subcarpetas.
//      Requiere que el navegador permita esa API, cosa que un Chrome
//      administrado por la empresa puede tener bloqueada por política.
//   b) Si no (no pulsaste el botón, lo cancelaste, la política lo bloquea, o
//      es otro navegador), al terminar se descarga UN archivo .zip que ya
//      lleva las carpetas dentro: al descomprimirlo queda exactamente la
//      misma estructura. Esto funciona siempre, sin permisos de ningún tipo.
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

  // La barra "/" en el nombre de una descarga sólo crea subcarpetas cuando
  // el archivo viene de una URL real (http); un "blob:" generado aquí mismo
  // siempre cae plano en Descargas, sea cual sea el nombre que se le ponga
  // — por eso la primera versión no organizaba nada pese a llevar las
  // barras en el nombre. La forma que sí funciona es pedir permiso una vez
  // sobre una carpeta (File System Access API, sólo Chrome/Edge) y escribir
  // ahí las subcarpetas de verdad.
  //
  // Pedir ese permiso exige un clic real de la persona (un script pegado en
  // la consola no cuenta como tal para el navegador), así que se muestra un
  // botón en la pantalla y se espera a que lo pulses.
  async function elegirCarpeta() {
    if (!window.showDirectoryPicker) {
      console.log("Este navegador no permite elegir carpeta (no existe showDirectoryPicker): irá todo en un ZIP.");
      return null;
    }
    return new Promise((resolve) => {
      const boton = document.createElement("button");
      boton.textContent = "📁 Elegir dónde guardar los PDF";
      Object.assign(boton.style, {
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: 2147483647,
        padding: "14px 22px",
        fontSize: "16px",
        fontWeight: "bold",
        background: "#0a6ed1",
        color: "#fff",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        boxShadow: "0 2px 10px rgba(0,0,0,.4)",
      });
      boton.onclick = async () => {
        boton.remove();
        let handle;
        try {
          // Sin "mode: readwrite" el permiso sale de sólo lectura y cada
          // intento de crear una carpeta o escribir un archivo se rechaza.
          handle = await window.showDirectoryPicker({ mode: "readwrite" });
        } catch (err) {
          // Puede ser que cancelaras el cuadro, o que el navegador tenga la
          // API bloqueada por política de la empresa. El motivo se imprime
          // en vez de tragárselo, que es lo que despistaba antes.
          console.log(`No se pudo elegir carpeta (${err.name}: ${err.message}). Irá todo en un ZIP.`);
          resolve(null);
          return;
        }

        // El picker puede devolver la carpeta sin que el permiso de
        // escritura haya quedado realmente concedido (depende de la
        // versión del navegador); se pide explícitamente y se comprueba.
        const permiso = await handle.requestPermission({ mode: "readwrite" }).catch(() => "denied");
        if (permiso !== "granted") {
          console.log("No quedó permiso de escritura sobre esa carpeta. Irá todo en un ZIP.");
          resolve(null);
          return;
        }

        // Prueba real de escritura, no sólo de permiso: en alguna carpeta
        // (por ejemplo, una unidad de red o protegida) el permiso puede
        // darse por bueno y aun así fallar al crear el archivo.
        try {
          const prueba = await handle.getFileHandle(".prueba_de_escritura", { create: true });
          const escritura = await prueba.createWritable();
          await escritura.write(new Uint8Array([0]));
          await escritura.close();
          await handle.removeEntry(".prueba_de_escritura").catch(() => {});
        } catch (err) {
          console.log(`No pude escribir en esa carpeta (${err.message}). Irá todo en un ZIP.`);
          resolve(null);
          return;
        }

        resolve(handle);
      };
      document.body.appendChild(boton);
    });
  }

  /** Crea (si hace falta) las subcarpetas de "ruta" y escribe el archivo ahí. */
  async function guardarEnCarpeta(raiz, ruta, datos) {
    const partes = ruta.split("/");
    const nombreArchivo = partes.pop();
    let carpeta = raiz;
    for (const parte of partes) {
      carpeta = await carpeta.getDirectoryHandle(parte, { create: true });
    }
    const archivo = await carpeta.getFileHandle(nombreArchivo, { create: true });
    const escritura = await archivo.createWritable();
    await escritura.write(datos);
    await escritura.close();
  }

  // Cuando no se puede escribir en una carpeta —Chrome de empresa con la
  // API bloqueada por política, otro navegador, o cancelaste el cuadro— los
  // PDF se juntan en un ZIP que ya lleva las carpetas dentro. Al
  // descomprimirlo queda exactamente la misma estructura que deja
  // APLICACION.bat, sin depender de ningún permiso especial.
  const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /**
   * ZIP sin comprimir (método "store"): los PDF ya vienen comprimidos, así
   * que volver a comprimirlos no ahorraría nada y obligaría a cargar una
   * librería externa, que la política de seguridad de la página de SAP
   * puede bloquear. Las barras de "ruta" son las que crean las carpetas.
   */
  function crearZip(archivos) {
    const codificador = new TextEncoder();
    const ahora = new Date();
    const hora = ((ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1)) & 0xffff;
    const fecha = (((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate()) & 0xffff;

    const locales = [];
    const central = [];
    let desplazamiento = 0;

    for (const { ruta, datos } of archivos) {
      const nombre = codificador.encode(ruta);
      const crc = crc32(datos);

      const cabecera = new DataView(new ArrayBuffer(30));
      cabecera.setUint32(0, 0x04034b50, true);
      cabecera.setUint16(4, 20, true);
      cabecera.setUint16(6, 0x0800, true); // nombres en UTF-8
      cabecera.setUint16(8, 0, true); // sin compresión
      cabecera.setUint16(10, hora, true);
      cabecera.setUint16(12, fecha, true);
      cabecera.setUint32(14, crc, true);
      cabecera.setUint32(18, datos.length, true);
      cabecera.setUint32(22, datos.length, true);
      cabecera.setUint16(26, nombre.length, true);
      cabecera.setUint16(28, 0, true);
      locales.push(new Uint8Array(cabecera.buffer), nombre, datos);

      const entrada = new DataView(new ArrayBuffer(46));
      entrada.setUint32(0, 0x02014b50, true);
      entrada.setUint16(4, 20, true);
      entrada.setUint16(6, 20, true);
      entrada.setUint16(8, 0x0800, true);
      entrada.setUint16(10, 0, true);
      entrada.setUint16(12, hora, true);
      entrada.setUint16(14, fecha, true);
      entrada.setUint32(16, crc, true);
      entrada.setUint32(20, datos.length, true);
      entrada.setUint32(24, datos.length, true);
      entrada.setUint16(28, nombre.length, true);
      entrada.setUint32(42, desplazamiento, true);
      central.push(new Uint8Array(entrada.buffer), nombre);

      desplazamiento += 30 + nombre.length + datos.length;
    }

    const tamanoCentral = central.reduce((n, p) => n + p.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, archivos.length, true);
    fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamanoCentral, true);
    fin.setUint32(16, desplazamiento, true);

    return new Blob([...locales, ...central, new Uint8Array(fin.buffer)], { type: "application/zip" });
  }

  function descargarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // Si falla escribir en la carpeta elegida (permiso revocado a mitad de
  // camino, unidad de red que se cae, etc.) el PDF no se pierde: se guarda
  // para el ZIP del final, y el resto del lote sigue igual.
  async function guardarArchivo(raiz, ruta, buffer, paraZip) {
    const datos = new Uint8Array(buffer);
    if (raiz) {
      try {
        await guardarEnCarpeta(raiz, ruta, datos);
        return { organizado: true };
      } catch (err) {
        console.log(`     · ${ruta}: no pude escribir en la carpeta elegida (${err.message}), va al ZIP`);
      }
    }
    paraZip.push({ ruta, datos });
    return { organizado: false };
  }

  // Busca un lote (rellena el campo, pulsa Consulta, lee la rejilla y baja
  // cada PDF) y devuelve lo guardado y lo que falló, para ese lote solo.
  async function descargarLote(lote, raiz, paraZip) {
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

        const { organizado } = await guardarArchivo(raiz, ruta, buffer, paraZip);
        guardados.push(ruta);
        console.log(`     · ${ruta} (${Math.round(buffer.byteLength / 1024)} kB)${organizado ? "" : " — va al ZIP"}`);

        await cerrarVisor(doc);
        await espera(500);
      }
    }

    return { guardados, fallos };
  }

  // --------------------------------------------------------------- inicio ---

  console.log("Si quieres que los PDF se escriban directamente en una carpeta tuya, pulsa el botón azul de arriba a la derecha. Si no, se descargará un ZIP con las carpetas dentro.");
  const raiz = await elegirCarpeta();

  const texto = window.prompt(
    "¿Qué lote(s) quieres descargar? Uno por línea, o separados por coma/espacio."
  );
  if (!texto) return;

  const lotes = [...new Set(texto.split(/[\s,;]+/).map((l) => l.trim()).filter(Boolean))];
  if (lotes.length === 0) return;

  const guardadosTotal = [];
  const fallosTotal = [];
  const paraZip = [];

  for (const lote of lotes) {
    console.log(`Lote ${lote}`);
    const { guardados, fallos } = await descargarLote(lote, raiz, paraZip);
    guardadosTotal.push(...guardados);
    fallosTotal.push(...fallos);
    // Entre un lote y el siguiente conviene una pausa breve: la pantalla
    // necesita respirar antes de aceptar una nueva búsqueda.
    if (lotes.indexOf(lote) < lotes.length - 1) await espera(1000);
  }

  let destino = raiz ? "en la carpeta que elegiste" : "";
  if (paraZip.length > 0) {
    const nombreZip = `SAP_${lotes.length === 1 ? lotes[0] : `${lotes.length}_lotes`}.zip`;
    descargarBlob(crearZip(paraZip), nombreZip);
    destino = `en ${nombreZip} (descomprímelo y quedan las carpetas por producto, etapa y tipo)`;
  }

  alert(
    `Listo. ${lotes.length} lote(s) procesado(s).\n\n` +
      `Guardados (${guardadosTotal.length}) ${destino}:\n${guardadosTotal.join("\n") || "ninguno"}` +
      (fallosTotal.length ? `\n\nCon problemas (${fallosTotal.length}):\n${fallosTotal.join("\n")}` : "")
  );
})();
