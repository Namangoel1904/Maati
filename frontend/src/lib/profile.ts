export type TransportMode = "ebus" | "walk" | "auto";
export type RefuelPreference = "tea_coffee" | "high_protein_veg_snacks" | "cool_drinks";
export type VibePreference = "nature" | "urban" | "quiet";
export type PlacePreference = "parks" | "cafes" | "culture" | "markets";

export interface MaatiProfile {
  area: string;
  city: string;
  transportMode: TransportMode;
  refuelPreference: RefuelPreference;
  vibe: VibePreference;
  placePreferences: PlacePreference[];
}

export interface TransitLeg { mode: string; line: string | null; boardAt: string | null; getOffAt: string | null }
export interface TransitAlternative { duration: string | null; legs: TransitLeg[] }
export interface PlaceRecommendation {
  id: string; name: string; shortPitch?: string; category: string; latitude: number; longitude: number;
  distanceKm: number; distanceLabel?: string; directionsUrl?: string; suggestedActivities: string[];
}
export interface SavedItinerary {
  place: PlaceRecommendation; origin: string; city: string; transportMode?: string; preparedAt: string;
  transitLegs: TransitLeg[]; transitAlternatives: TransitAlternative[]; routeDuration: string | null; directionsUrl: string;
}
