import React, { createContext, useContext, ReactNode } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';

// Define the libraries array once, statically
const LIBRARIES: ("geometry")[] = ["geometry"];

interface GoogleMapsContextType {
  isLoaded: boolean;
  loadError: Error | undefined;
}

const GoogleMapsContext = createContext<GoogleMapsContextType>({
  isLoaded: false,
  loadError: undefined,
});

export const GoogleMapsProvider = ({ children }: { children: ReactNode }) => {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: (process.env.GoogleMapsApiKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) as string,
    version: 'weekly',
    libraries: LIBRARIES,
  });

  return (
    <GoogleMapsContext.Provider value={{ isLoaded, loadError }}>
      {children}
    </GoogleMapsContext.Provider>
  );
};

export const useGoogleMaps = () => useContext(GoogleMapsContext);