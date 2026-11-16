import { useCallback, useEffect, useState } from 'react';

export type GeolocationPermissionState =
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unsupported';

export type GpsCoordinateSource = 'hardware' | 'ward_anchor';

export interface HardwareGpsCoordinates {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAtIso: string;
  source: GpsCoordinateSource;
}

export interface UseHardwareGeolocationResult {
  coordinates: HardwareGpsCoordinates | null;
  permissionState: GeolocationPermissionState;
  isCapturing: boolean;
  errorMessage: string | null;
  capturePosition: (
    fallbackAnchor?: { lat: number; lng: number }
  ) => Promise<HardwareGpsCoordinates | null>;
  applyFallbackCoordinates: (lat: number, lng: number) => HardwareGpsCoordinates;
}

/**
 * Hardware GPS sensor hook wrapping browser-native navigator.geolocation.
 * Requests high-accuracy coordinates and seamlessly falls back to verified
 * ward anchor coordinates when iframe Permissions-Policy or OS blocks GPS.
 */
export function useHardwareGeolocation(locale: 'sw' | 'en' = 'sw'): UseHardwareGeolocationResult {
  const isSw = locale === 'sw';
  const [coordinates, setCoordinates] = useState<HardwareGpsCoordinates | null>(null);
  const [permissionState, setPermissionState] = useState<GeolocationPermissionState>(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return 'unsupported';
    }
    return 'prompt';
  });
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPermissionState('unsupported');
      return;
    }

    if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          setPermissionState(status.state as GeolocationPermissionState);
          status.onchange = () => {
            setPermissionState(status.state as GeolocationPermissionState);
          };
        })
        .catch(() => {
          // Permissions API unavailable in some WebViews; rely on getCurrentPosition
        });
    }
  }, []);

  const applyFallbackCoordinates = useCallback((lat: number, lng: number): HardwareGpsCoordinates => {
    const anchored: HardwareGpsCoordinates = {
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      accuracyMeters: 25,
      capturedAtIso: new Date().toISOString(),
      source: 'ward_anchor',
    };
    setCoordinates(anchored);
    setErrorMessage(null);
    return anchored;
  }, []);

  const capturePosition = useCallback(
    async (
      fallbackAnchor?: { lat: number; lng: number }
    ): Promise<HardwareGpsCoordinates | null> => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        setPermissionState('unsupported');
        if (fallbackAnchor) {
          return applyFallbackCoordinates(fallbackAnchor.lat, fallbackAnchor.lng);
        }
        setErrorMessage(
          isSw
            ? 'Kifaa hiki hakina huduma ya GPS ya kivinjari.'
            : 'Browser geolocation API is unavailable on this device.'
        );
        return null;
      }

      setIsCapturing(true);
      setErrorMessage(null);

      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const captured: HardwareGpsCoordinates = {
              latitude: Number(pos.coords.latitude.toFixed(6)),
              longitude: Number(pos.coords.longitude.toFixed(6)),
              accuracyMeters: Math.round(pos.coords.accuracy || 10),
              capturedAtIso: new Date(pos.timestamp || Date.now()).toISOString(),
              source: 'hardware',
            };
            setCoordinates(captured);
            setPermissionState('granted');
            setIsCapturing(false);
            resolve(captured);
          },
          (err) => {
            setIsCapturing(false);
            if (err.code === err.PERMISSION_DENIED) {
              setPermissionState('denied');
            }
            if (fallbackAnchor) {
              const anchored = applyFallbackCoordinates(fallbackAnchor.lat, fallbackAnchor.lng);
              resolve(anchored);
              return;
            }
            if (err.code === err.PERMISSION_DENIED) {
              setErrorMessage(
                isSw
                  ? 'GPS ya kivinjari imezuiwa; majira ya kata yametumika.'
                  : 'Browser GPS blocked; verified ward coordinates active.'
              );
            } else if (err.code === err.POSITION_UNAVAILABLE) {
              setErrorMessage(
                isSw
                  ? 'Mawimbi ya satelaiti za GPS hayajapatikana kwa sasa.'
                  : 'Device GPS signal is temporarily unavailable.'
              );
            } else {
              setErrorMessage(
                isSw
                  ? 'Muda wa kusoma GPS umeisha. Jaribu tena ukiwa nje ya jengo.'
                  : 'GPS sensor timeout reached. Retry outdoors for faster satellite fix.'
              );
            }
            resolve(null);
          },
          {
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0,
          }
        );
      });
    },
    [applyFallbackCoordinates, isSw]
  );

  return {
    coordinates,
    permissionState,
    isCapturing,
    errorMessage,
    capturePosition,
    applyFallbackCoordinates,
  };
}
