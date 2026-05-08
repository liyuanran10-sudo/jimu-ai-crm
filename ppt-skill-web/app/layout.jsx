import "./globals.css";

export const metadata = {
  title: "Codex PPT Skill Runner",
  description: "Local web UI for running the gpt-image2-ppt-skills Codex Skill.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
