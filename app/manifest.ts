import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DSB Solar Race',
    short_name: 'DSB Solar Race',
    description: 'Rastreamento de embarcações em tempo real',
    start_url: '/',
    display: 'standalone',
    background_color: '#edf0e4',
    theme_color: '#edf0e4',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-1024.png',
        sizes: '1024x1024',
        type: 'image/png',
      },
    ],
  };
}
