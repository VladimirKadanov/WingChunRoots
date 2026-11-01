'use client';

// "Drop the pin" (milestone M11, In scope 2): a small MapLibre map in the school form. A tap or a
// click puts the pin there; dragging the pin moves it. No geocoding service: the map opens at the
// school's pin or at its city's centre (GeoNames). The latitude and longitude fields beside it are
// the way without a pointer (and without WebGL): the map only fills them in. It loads with
// next/dynamic when the Sifu asks for it, so the form's page loads no map code until then.

import 'maplibre-gl/dist/maplibre-gl.css';

import { AttributionControl, Map, Marker, NavigationControl } from '@vis.gl/react-maplibre';

import { ExactPinMark } from '@/components/schools/marks';
import type { GeoPointDto } from '@/server/dto/schools';
import { maplibregl } from './maplibre';
import { usePageTheme } from './use-theme';

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export interface PinPickerProps {
  /** Where the map opens when there is no pin yet: the city's centre. */
  center: GeoPointDto;
  point: GeoPointDto | null;
  styles: { light: string; dark: string };
  onPick: (point: GeoPointDto) => void;
}

export default function PinPicker({ center, point, styles, onPick }: PinPickerProps) {
  const theme = usePageTheme();
  const start = point ?? center;
  return (
    <div className="relative h-72 overflow-hidden rounded-sm border border-border-strong md:h-96" data-testid="pin-picker">
      <Map
        mapLib={maplibregl}
        mapStyle={styles[theme]}
        styleDiffing={false}
        initialViewState={{ longitude: start.lng, latitude: start.lat, zoom: point ? 15 : 11 }}
        minZoom={2}
        maxZoom={18}
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
        style={{ width: '100%', height: '100%' }}
        cursor="crosshair"
        onLoad={(event) => event.target.getCanvas().setAttribute('aria-label', 'Map for the pin. Tap or click where the school is; the latitude and longitude fields fill in.')}
        onClick={(event) => onPick({ lat: round5(event.lngLat.lat), lng: round5(event.lngLat.lng) })}
      >
        <AttributionControl position="top-right" compact />
        <NavigationControl position="top-right" showCompass={false} />
        {point ? (
          <Marker
            longitude={point.lng}
            latitude={point.lat}
            anchor="bottom"
            draggable
            onDragEnd={(event) => onPick({ lat: round5(event.lngLat.lat), lng: round5(event.lngLat.lng) })}
          >
            <span className="grid size-11 place-items-end justify-items-center text-fg" aria-hidden="true">
              <ExactPinMark size={36} />
            </span>
          </Marker>
        ) : null}
      </Map>
    </div>
  );
}
