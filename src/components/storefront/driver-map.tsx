'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';

/**
 * Live courier position.
 *
 * Leaflet is imported dynamically inside the effect: it touches `window` at
 * module scope and would break server rendering otherwise. Tiles come from
 * OpenStreetMap, so the map needs no vendor token and reveals no courier
 * provider.
 */
export function DriverMap({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const icon = L.divIcon({
        className: '',
        html:
          '<span style="display:block;width:18px;height:18px;border-radius:9999px;' +
          'background:var(--brand-accent, #f97316);border:3px solid #fff;' +
          'box-shadow:0 0 0 2px rgba(0,0,0,.15)"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      markerRef.current = L.marker([lat, lng], { icon, title: label }).addTo(map);
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Created once; position updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the existing marker rather than rebuilding the map on every ping.
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([lat, lng]);
    mapRef.current.panTo([lat, lng], { animate: true });
  }, [lat, lng]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Map showing ${label} near ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
      className="h-64 w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100"
    />
  );
}
