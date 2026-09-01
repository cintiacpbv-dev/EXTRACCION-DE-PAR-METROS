// La bibliografía (guías ISPE, ICH y demás) vive en su propia aplicación,
// con su propia base de datos y sus propias claves de IA: no es algo que
// este proyecto pueda absorber sin duplicar todo eso. Se embebe tal cual
// —el sitio no manda ninguna cabecera que lo impida— y ocupa la pantalla
// entera, sin título ni recuadro propios: cualquier marco alrededor era
// justo lo que delataba que había una página metida dentro de otra.
const URL_CONSULTA = "https://consulta-pdf.vercel.app/";

export default function ConsultaPdf() {
  return (
    <iframe
      className="consulta-marco"
      src={URL_CONSULTA}
      title="Consulta a tu PDF"
      allow="clipboard-write"
    />
  );
}
