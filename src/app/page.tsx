'use client';

import dynamic from 'next/dynamic';

// Dynamically load the RecorderComponent with SSR disabled
const RecorderComponent = dynamic(
  () => import('../components/RecorderComponent'),
  { ssr: false }
);

export default function Home() {
  return (
    <main className="w-full min-h-screen">
      <RecorderComponent />
    </main>
  );
}
