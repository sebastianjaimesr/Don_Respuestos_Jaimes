import { PanelChat } from './PanelChat';

/** Chat a pantalla completa (ruta /chat), útil en celulares o como enlace directo. */
export default function PaginaChat() {
  return (
    <div className="flex h-full flex-col bg-noche-950">
      <PanelChat pantallaCompleta className="h-full flex-1" />
    </div>
  );
}
