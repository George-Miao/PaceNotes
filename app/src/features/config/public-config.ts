import { createServerFn } from "@tanstack/react-start";

export type PublicConfig = {
  googleMapsApiKey: string;
  googleMapId: string;
};

export const getPublicConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig> => ({
    googleMapsApiKey: requiredEnvironment("GOOGLE_MAPS_API_KEY"),
    googleMapId: requiredEnvironment("GOOGLE_MAP_ID"),
  }),
);

export function readPublicConfig(): PublicConfig {
  return {
    googleMapsApiKey: readMeta("pacenotes-google-maps-api-key"),
    googleMapId: readMeta("pacenotes-google-map-id"),
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readMeta(name: string): string {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";
}
