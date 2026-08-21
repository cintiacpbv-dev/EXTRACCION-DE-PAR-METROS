// Iconografía minimalista de trazo: un solo grosor, esquinas redondeadas y
// sin relleno, para que acompañe al contenido sin competir con él.

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base} {...rest}>
      {children}
    </svg>
  );
}

export function IconDocument(props) {
  return (
    <Svg {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Svg>
  );
}

export function IconUpload(props) {
  return (
    <Svg {...props}>
      <path d="M12 16V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}

export function IconCopy(props) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </Svg>
  );
}

export function IconDownload(props) {
  return (
    <Svg {...props}>
      <path d="M12 4v12" />
      <path d="m8 12 4 4 4-4" />
      <path d="M4 20h16" />
    </Svg>
  );
}

export function IconCode(props) {
  return (
    <Svg {...props}>
      <path d="m9 8-5 4 5 4" />
      <path d="m15 8 5 4-5 4" />
    </Svg>
  );
}

export function IconClose(props) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconCheck(props) {
  return (
    <Svg {...props}>
      <path d="m4 12 5 5L20 6" />
    </Svg>
  );
}

export function IconCloud(props) {
  return (
    <Svg {...props}>
      <path d="M7 18a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 17.5 10H18a3.5 3.5 0 0 1 0 7z" />
    </Svg>
  );
}

export function IconDrive(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Svg>
  );
}

export function IconFlask(props) {
  return (
    <Svg {...props}>
      <path d="M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path d="M9 3h6" />
      <path d="M7.5 14h9" />
    </Svg>
  );
}

export function IconLayers(props) {
  return (
    <Svg {...props}>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 14 9 5 9-5" />
    </Svg>
  );
}

export function IconFilter(props) {
  return (
    <Svg {...props}>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </Svg>
  );
}

export function IconAlert(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16h.01" />
    </Svg>
  );
}
