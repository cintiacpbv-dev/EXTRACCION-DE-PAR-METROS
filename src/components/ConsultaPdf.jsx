// La bibliografía (guías ISPE, ICH y demás) vive en su propia aplicación,
// con su propia base de datos y sus propias claves de IA: no es algo que
// este proyecto pueda absorber sin duplicar todo eso. Se embebe tal cual
// —el sitio no manda ninguna cabecera que lo impida— y ocupa la pantalla
// entera, sin título ni recuadro propios: cualquier marco alrededor era
// justo lo que delataba que había una página metida dentro de otra.
//
// Cuando llega una pregunta ya armada (desde "Validar contra la
// bibliografía"), no se abre la portada sino el chat directamente, con la
// pregunta en "?q=": esa aplicación la envía sola en cuanto monta.
const URL_CONSULTA = "https://consulta-pdf.vercel.app/";

export default function ConsultaPdf({ query }) {
  const src = query?.pregunta
    ? `${URL_CONSULTA}chat?q=${encodeURIComponent(query.pregunta)}`
    : URL_CONSULTA;

  return (
    <iframe
      // Con la misma pregunta y la misma clave el iframe no se vuelve a
      // montar, y por lo tanto no se reenvía: la clave cambia en cada
      // "Validar", aunque la pregunta sea idéntica a la anterior.
      key={query?.nonce ?? "biblioteca"}
      className="consulta-marco"
      src={src}
      title="Consulta a tu PDF"
      allow="clipboard-write"
    />
  );
}
