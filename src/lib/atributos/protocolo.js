// Los atributos de calidad que trae el protocolo, cuando se sube.
//
// Es opcional: la sección funciona sin él, porque los atributos también se
// leen del propio registro. Lo que aporta el protocolo es la
// ESPECIFICACIÓN — el rango contra el que se juzga el atributo, redactado
// para el expediente y no abreviado como en la casilla del registro— y algún
// atributo que el registro no anota porque se analiza en el laboratorio.
//
// No se vuelve a escribir un lector: el protocolo ya tiene el suyo
// (protocolo/parametros.js, que lee las tablas "Parámetro · Modo de
// verificación · Rango de operación" de cada etapa). Aquí sólo se separan
// sus filas con el mismo criterio que se aplica al registro, para que un
// atributo se llame igual venga de donde venga.

import { leerParametrosDeProtocolo } from "../protocolo/parametros.js";
import { atributoDe } from "./vocabulario.js";

/**
 * Lee un protocolo y devuelve sus atributos de calidad, con su etapa y su
 * especificación.
 *
 * Las filas del protocolo traen el nombre repartido en dos columnas —el grupo
 * y el detalle—, así que se prueban las dos formas: "DUREZA" a secas y
 * "DUREZA DE CÁPSULA SECA". Con una basta para reconocerlo.
 */
export async function atributosDelProtocolo(file) {
  const { nombre, etapas } = await leerParametrosDeProtocolo(file);

  const porClave = new Map();
  let parametros = 0;

  for (const etapa of etapas || []) {
    for (const fila of etapa.filas || []) {
      if (fila.tipo !== "parametro") continue;
      parametros++;

      const completo = [fila.grupo, fila.detalle].filter(Boolean).join(" ").trim();
      if (!completo) continue;

      // El rango del protocolo hace de lectura: sin él no se sabría si la
      // fila es un atributo que se mide o un encabezado del cuadro.
      const lectura = { label: completo, value: fila.rango || fila.modo || "", setpoint: fila.rango || "" };
      const atributo = atributoDe(lectura) || atributoDe({ ...lectura, label: fila.grupo || "" });
      if (!atributo) continue;

      const clave = `${etapa.etapa}|${atributo}`;
      if (!porClave.has(clave)) {
        porClave.set(clave, {
          nombre: atributo,
          etapa: etapa.etapa,
          criterios: [],
          origen: "protocolo",
          ejemplo: completo,
        });
      }
      const a = porClave.get(clave);
      const rango = String(fila.rango || "").trim();
      if (rango && !a.criterios.includes(rango)) a.criterios.push(rango);
    }
  }

  return { nombre, atributos: [...porClave.values()], parametros };
}
