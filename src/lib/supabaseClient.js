import { createClient } from "@supabase/supabase-js";

// Vite reemplaza `import.meta.env` al construir; fuera de Vite —en las
// pruebas, que corren los módulos con Node a secas— no existe y leerlo
// directamente rompía el import entero. Con el respaldo a {} el mismo archivo
// vale en los dos sitios y Supabase queda simplemente apagado.
const env = import.meta.env ?? {};

const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(url && anonKey);

export const supabase = supabaseEnabled ? createClient(url, anonKey) : null;
