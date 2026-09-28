import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FilmTwin',
  description: 'Find your film twin — personalised recommendations powered by Apache Spark ALS',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>{children}</body>
    </html>
  )
}
