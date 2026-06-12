'use client';

import dynamic from 'next/dynamic';

const SubteDashboard = dynamic(() => import('./SubteDashboard'), {
  ssr: false,
});

export default SubteDashboard;
