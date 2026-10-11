import type { MaatiProfile, PlaceRecommendation, SavedItinerary, TransitAlternative, TransitLeg } from "@/lib/profile";

export interface User { id: string; email: string; username: string }
export interface AuthResponse { user: User | null; profile: MaatiProfile | null }
export interface WeatherSnapshot { temperature: number; humidity: number; [key: string]: unknown }
export interface ViabilityResult { seedType: string; viabilityScore: number; viabilityIndex: number; rawProbability: number | null; isKnownCrop: boolean; weather: WeatherSnapshot }
export interface AdvicePayload { seedType: string; location: string; viabilityScore: number | null; weather: Record<string, unknown>; localTime: string }
export interface AdviceResponse { message: string; mission_type: string; scrapbook_badge_id: string; transit_link: string | null; audio_theme: string | null }
export interface MissionAcceptance { missionId: string; createdAt: string; itinerary: SavedItinerary | null }
export interface MeResponse { user: User; profile: MaatiProfile | null; itinerary: (SavedItinerary & { missionId: string; missionType: string; message: string; status: string }) | null; currentMission: { missionId: string; missionType: string; message: string; badgeId: string; status: string; createdAt: string } | null; stats: ScrapbookStats; badges: ScrapbookBadge[] }
export interface BreakState { date: string; nextThreshold: number; skippedFirst: boolean }
export interface ScrapbookStats { streak: number; seedsPlanted: number; citiesExplored: number; breaksCompleted: number }
export interface ScrapbookBadge { id: string; title: string; condition: string; pixel: string; tone: string; unlockedAt: string }
export interface FeedPost { id: string; username: string; initials: string; city: string; timeLabel: string; mission: string; caption: string; badgeId: string; photoUrl: string | null; photoLabel: string; photoEmoji: string; photoTone: "leaf" | "sunset" | "sky" | "earth"; isMine: boolean; reactions: { sprouted: number; touchedGrass: number }; myReactions: { sprouted: boolean; touchedGrass: boolean } }
export interface PlaceRecommendationsResponse { origin: string; recommendations: PlaceRecommendation[]; source: string; transportMode: string }
export interface TransitGuideResponse { directionsUrl: string; routeDuration: string | null; transitLegs: TransitLeg[]; transitAlternatives: TransitAlternative[] }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Request failed (${response.status})`);
  return result as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
export const signup = (body: { email: string; username: string; password: string }) => post<AuthResponse>("/api/auth/signup", body);
export const login = (body: { email: string; password: string }) => post<AuthResponse>("/api/auth/login", body);
export const logout = () => post<{ ok: boolean }>("/api/auth/logout", {});
export const getSession = () => request<AuthResponse>("/api/auth/me");
export const getMe = () => request<MeResponse>("/api/me");
export const getBreakState = (date: string) => request<BreakState>(`/api/break-state?date=${encodeURIComponent(date)}`);
export const saveBreakState = (state: BreakState) => request<BreakState>("/api/break-state", { method: "PUT", body: JSON.stringify(state) });
export const syncScreenTime = (date: string, activeSeconds: number) => request<{ date: string; activeSeconds: number }>("/api/screen-time", { method: "PUT", body: JSON.stringify({ date, activeSeconds }) });
export const saveProfile = (profile: MaatiProfile) => request<{ profile: MaatiProfile }>("/api/profile", { method: "PUT", body: JSON.stringify(profile) });
export const getFeed = () => request<{ posts: FeedPost[] }>("/api/feed");
export const toggleReaction = (postId: string, reaction: "sprouted" | "touched_grass") => post<{ reactions: { sprouted: number; touchedGrass: number }; active: boolean }>(`/api/posts/${encodeURIComponent(postId)}/reactions`, { reaction });

export function checkViability(seedType: string, location: string): Promise<ViabilityResult> { return post("/api/viability", { seedType, location }); }
export function getAdvice(payload: AdvicePayload): Promise<AdviceResponse> { return post("/api/advice", payload); }
export function getNearbyPlaces(): Promise<PlaceRecommendationsResponse> { return post("/api/places/recommend", {}); }
export function acceptMission(body: { missionType: string; message: string; badgeId: string; place?: PlaceRecommendation }): Promise<MissionAcceptance> { return post("/api/accept-mission", body); }
export function completeMission(body: { missionId: string; photoLabel: string; photoEmoji: string; photoTone: "leaf" | "sunset" | "sky" | "earth"; caption?: string; photoData?: string | null }): Promise<{ post: FeedPost }> { return post("/api/missions/complete", body); }
export function updatePost(postId: string, body: { caption: string; photoData?: string | null }): Promise<{ ok: boolean }> { return request(`/api/posts/${encodeURIComponent(postId)}`, { method: "PUT", body: JSON.stringify(body) }); }
