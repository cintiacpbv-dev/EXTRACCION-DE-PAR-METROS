import { useState } from "react";
import { IconExternalLink } from "./Icons.jsx";

// La bibliografía (guías ISPE, ICH y demás) vive en su propia aplicación,
// con su propia base de datos y sus propias claves de IA: no es algo que
// este proyecto pueda absorber sin duplicar todo eso. Se embebe tal cual
// —el sitio no manda ninguna cabecera que lo impida— para que se sienta
// como una sección más de aquí y no como un enlace que saca de la página.
const URL_CONSULTA = "https://consulta-pdf.vercel.app/";

export default function ConsultaPdf() {
  // El iframe tarda un instante en pintar su propio fondo oscuro; mientras
  // tanto se ve el de esta página por debajo, que es el mismo tono, así que
  // no hay parpadeo — pero si el sitio externo tardara o fallara, este aviso
  // deja de ser un rectángulo vacío sin explicación.
  const [cargado, setCargado] = useState(false);

  return (
    <section className="card card--consulta">
      <div className="consulta-cab">
        <div>
          <h2 className="consulta-cab__titulo">Consulta a tu bibliografía</h2>
          <p className="muted">
            Guías ISPE, ICH y demás referencias ya cargadas — pregúntales directamente.
          </p>
        </div>
        <a
          className="btn btn--ghost"
          href={URL_CONSULTA}
          target="_blank"
          rel="noreferrer"
        >
          <IconExternalLink size={14} /> Abrir en su propia pestaña
        </a>
      </div>

      <div className="consulta-marco">
        {!cargado && <div className="consulta-marco__espera">Abriendo Consulta PDF…</div>}
        <iframe
          src={URL_CONSULTA}
          title="Consulta a tu PDF"
          onLoad={() => setCargado(true)}
          allow="clipboard-write"
        />
      </div>
    </section>
  );
}
