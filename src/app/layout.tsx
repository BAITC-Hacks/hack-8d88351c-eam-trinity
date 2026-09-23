import type { Metadata } from "next";
import "./globals.css";
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
