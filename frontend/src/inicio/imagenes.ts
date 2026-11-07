// Renders 3D de repuestos (WebP con transparencia) en dos tamaños para `srcset`.
// Se generaron con herramientas/renders (ver README de esa carpeta).
import disco480 from '../assets/repuestos/disco-freno-480.webp';
import disco960 from '../assets/repuestos/disco-freno-960.webp';
import arrastre480 from '../assets/repuestos/kit-arrastre-480.webp';
import arrastre960 from '../assets/repuestos/kit-arrastre-960.webp';
import bujia480 from '../assets/repuestos/bujia-480.webp';
import bujia960 from '../assets/repuestos/bujia-960.webp';
import filtro480 from '../assets/repuestos/filtro-aceite-480.webp';
import filtro960 from '../assets/repuestos/filtro-aceite-960.webp';

export interface ImagenRepuesto {
  src: string;
  srcSet: string;
  alt: string;
}

const img = (a: string, b: string, alt: string): ImagenRepuesto => ({ src: a, srcSet: `${a} 480w, ${b} 960w`, alt });

export const IMAGENES = {
  disco: img(disco480, disco960, 'Disco de freno tipo pétalo con portadisco azul'),
  arrastre: img(arrastre480, arrastre960, 'Corona con cadena de transmisión (kit de arrastre)'),
  bujia: img(bujia480, bujia960, 'Bujía de encendido'),
  filtro: img(filtro480, filtro960, 'Filtro de aceite'),
};

/** Imagen por categoría del catálogo (las categorías salen del backend). */
export const IMAGEN_POR_CATEGORIA: Record<string, ImagenRepuesto | undefined> = {
  disco_freno: IMAGENES.disco,
  kit_arrastre: IMAGENES.arrastre,
  bujia: IMAGENES.bujia,
  filtro_aceite: IMAGENES.filtro,
};
