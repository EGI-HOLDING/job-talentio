import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { AuthGate } from '@/components/shell/AuthGate';
import { Sidebar } from '@/components/shell/Sidebar';
import { Toaster } from '@/components/ui/Toaster';

export const metadata: Metadata = {
  title: 'Job Talentio Admin',
  description: 'Super Admin console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Toaster>
          <AuthGate>
            <div className="app">
              <Sidebar />
              <div className="main">
                {/* Pages read the URL for filter state, which needs a Suspense boundary. */}
                <Suspense fallback={null}>{children}</Suspense>
              </div>
            </div>
          </AuthGate>
        </Toaster>
      </body>
    </html>
  );
}
