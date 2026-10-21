/**
 * Categorías de repuestos que el asistente reconoce, con sinónimos de cómo
 * los piden los clientes en Colombia. Los sinónimos están normalizados
 * (minúsculas, sin tildes). Para agregar una categoría nueva basta con
 * añadirla aquí y usar la misma `clave` en productos.categoria.
 */
export interface Categoria {
  clave: string;
  etiqueta: string;
  sinonimos: string[];
  requierePosicion: boolean; // ¿hay que preguntar delantero/trasero?
  seguridad: boolean; // frenos, dirección, llantas → advertencia obligatoria
}

export const CATEGORIAS: Categoria[] = [
  { clave: 'pastillas_freno', etiqueta: 'Pastillas de freno', sinonimos: ['pastillas de freno', 'pastilla de freno', 'pastillas', 'pastilla', 'balatas'], requierePosicion: true, seguridad: true },
  { clave: 'bandas_freno', etiqueta: 'Bandas de freno', sinonimos: ['bandas de freno', 'banda de freno', 'bandas', 'zapatas'], requierePosicion: true, seguridad: true },
  { clave: 'disco_freno', etiqueta: 'Disco de freno', sinonimos: ['disco de freno', 'disco freno', 'disco'], requierePosicion: true, seguridad: true },
  { clave: 'filtro_aceite', etiqueta: 'Filtro de aceite', sinonimos: ['filtro de aceite', 'filtro aceite'], requierePosicion: false, seguridad: false },
  { clave: 'filtro_aire', etiqueta: 'Filtro de aire', sinonimos: ['filtro de aire', 'filtro aire'], requierePosicion: false, seguridad: false },
  { clave: 'bujia', etiqueta: 'Bujía', sinonimos: ['bujia', 'bujias'], requierePosicion: false, seguridad: false },
  { clave: 'kit_arrastre', etiqueta: 'Kit de arrastre', sinonimos: ['kit de arrastre', 'kit arrastre', 'arrastre', 'pinon y corona', 'kit de cadena', 'cadena y pinon'], requierePosicion: false, seguridad: false },
  { clave: 'llanta', etiqueta: 'Llanta', sinonimos: ['llanta', 'llantas', 'neumatico', 'neumaticos', 'caucho'], requierePosicion: true, seguridad: true },
  { clave: 'aceite_motor', etiqueta: 'Aceite de motor', sinonimos: ['aceite de motor', 'aceite motor', 'aceite 4t', 'aceite'], requierePosicion: false, seguridad: false },
  { clave: 'bombillo', etiqueta: 'Bombillo', sinonimos: ['bombillo', 'bombillos', 'bombilla', 'luz de farola', 'bombillo farola'], requierePosicion: false, seguridad: false },
  { clave: 'bateria', etiqueta: 'Batería', sinonimos: ['bateria', 'baterias', 'pila de la moto'], requierePosicion: false, seguridad: false },
  { clave: 'direccion', etiqueta: 'Rodamientos de dirección', sinonimos: ['cunas de direccion', 'cuna de direccion', 'rodamientos de direccion', 'direccion'], requierePosicion: false, seguridad: true },
];

/**
 * Palabras que por sí solas son ambiguas: el asistente debe preguntar.
 * Ej.: "filtro" puede ser de aire o de aceite.
 */
export const AMBIGUOS: { palabra: string; opciones: string[]; pregunta: string }[] = [
  { palabra: 'filtro', opciones: ['filtro_aire', 'filtro_aceite'], pregunta: '¿Necesitas el filtro de aire o el filtro de aceite?' },
  { palabra: 'filtros', opciones: ['filtro_aire', 'filtro_aceite'], pregunta: '¿Necesitas el filtro de aire o el filtro de aceite?' },
  { palabra: 'frenos', opciones: ['pastillas_freno', 'bandas_freno', 'disco_freno'], pregunta: '¿Buscas pastillas, bandas o disco de freno?' },
  { palabra: 'freno', opciones: ['pastillas_freno', 'bandas_freno', 'disco_freno'], pregunta: '¿Buscas pastillas, bandas o disco de freno?' },
];

export const categoriaPorClave = (clave: string) => CATEGORIAS.find((c) => c.clave === clave);
export const esCategoriaDeSeguridad = (clave: string) => categoriaPorClave(clave)?.seguridad ?? false;

export const ADVERTENCIA_SEGURIDAD =
  '⚠️ Por tu seguridad, este repuesto (frenos, dirección o llantas) debe tener la compatibilidad confirmada antes de instalarlo. Si tienes dudas, que lo revise un mecánico.';
