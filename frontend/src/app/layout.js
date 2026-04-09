import "./globals.css";
import "../components/Modal/modal.css";
import ToastProviders from "../components/Toast/ToastProviders";

export const metadata = {
  title: {
    default: "Campus Inventory",
    template: "%s | Campus Inventory",
  },
  description: "Sistema de conferência de patrimônio do Campus Aracruz.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ToastProviders>
          <main className="app-shell">{children}</main>
          <footer
            className="global-footer"
            aria-label="Informacoes de desenvolvimento"
          >
            O sistema está sendo desenvolvido pelos membros do Projeto "8926
            Digitalização e Comunicação Ativa no Campus Aracruz: Desenvolvimento
            de um Ecossistema para Otimização de Rotinas e Engajamento
            Comunitário", aprovado no SIGPESQ do IFES.
          </footer>
        </ToastProviders>
      </body>
    </html>
  );
}
