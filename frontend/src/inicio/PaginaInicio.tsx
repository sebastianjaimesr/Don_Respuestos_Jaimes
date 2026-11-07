import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import { useCallback, useRef } from 'react';
import { PanelChat, type ControlChat } from '../chat/PanelChat';
import { Hero } from './Hero';
import { Navbar } from './Navbar';
import { Caracteristicas, Catalogo, Contacto, Pie, SeccionAsistente, Servicios } from './Secciones';

/** Página de inicio pública: presentación de la tienda + asistente virtual integrado. */
export default function PaginaInicio() {
  const chat = useRef<ControlChat>(null);
  const preguntar = useCallback((t: string) => {
    chat.current?.preguntar(t);
    chat.current?.enfocar();
  }, []);
  const enfocarChat = useCallback(() => chat.current?.enfocar(), []);

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="relative min-h-full overflow-x-clip bg-noche-950 font-sans text-slate-200 selection:bg-electrico-500/40 selection:text-white">
          <a href="#asistente" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-noche-950">
            Ir al asistente virtual
          </a>
          <Navbar onAsistente={enfocarChat} />
          <main>
            <Hero onAsistente={enfocarChat} />
            <Caracteristicas />
            <Catalogo preguntar={preguntar} />
            <Servicios />
            <SeccionAsistente preguntar={preguntar}>
              <PanelChat ref={chat} className="h-[min(72svh,720px)] min-h-[500px] sm:h-[min(74svh,700px)]" />
            </SeccionAsistente>
            <Contacto preguntar={preguntar} />
          </main>
          <Pie />
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
