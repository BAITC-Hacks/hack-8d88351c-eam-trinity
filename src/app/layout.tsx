import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./map.css";
export const metadata: Metadata = {
  title: "CITYPROOF — лаборатория городских сценариев",
  description: "Аким на 5 часов. Проверяемые решения для учебного города.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
