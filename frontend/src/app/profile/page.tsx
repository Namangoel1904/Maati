"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, LogOut, MapPin, Save, Sprout } from "lucide-react";
import ScrapbookGrid from "@/components/ScrapbookGrid";
import PostComposer from "@/components/PostComposer";
import SeedPlantingGuide from "@/components/SeedPlantingGuide";
import { completeMission, getMe, getSession, logout, saveProfile as persistProfile, type MeResponse } from "@/lib/api";
import type { MaatiProfile, PlacePreference, RefuelPreference, TransportMode, VibePreference } from "@/lib/profile";

const PLACE_CHOICES: { id: PlacePreference; label: string }[] = [
  { id: "parks", label: "Parks & gardens" }, { id: "cafes", label: "Cafes & tea spots" },
  { id: "culture", label: "Museums & local sights" }, { id: "markets", label: "Markets & food courts" },
];
const EMPTY_PROFILE: MaatiProfile = { area: "", city: "Pune", transportMode: "ebus", refuelPreference: "tea_coffee", vibe: "nature", placePreferences: ["parks", "cafes"] };

export default function ProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<MeResponse | null>(null);
  const [form, setForm] = useState<MaatiProfile>(EMPTY_PROFILE);
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [composingPost, setComposingPost] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const refresh = useCallback(async () => {
    const session = await getSession();
    if (!session.user) { router.replace("/auth"); return; }
    const current = await getMe();
    setData(current);
    if (current.profile) setForm(current.profile);
    else setEditing(true);
  }, [router]);
  useEffect(() => { refresh().catch(e => setError(e instanceof Error ? e.message : "Could not load profile.")); }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => refresh().catch(() => {}), 15_000); return () => window.clearInterval(timer); }, [refresh]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await persistProfile(form); await refresh(); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save profile."); }
    finally { setBusy(false); }
  }
  function togglePlace(place: PlacePreference) {
    setForm(current => ({ ...current, placePreferences: current.placePreferences.includes(place) ? current.placePreferences.filter(p => p !== place) : [...current.placePreferences, place] }));
  }
  async function signOut() { await logout(); router.replace("/auth"); }
  const itinerary = data?.itinerary;
  const currentMission = data?.currentMission;
  const profileMissing = !data?.profile;

  async function finishMission(caption: string, photoData: string | null) {
    if (!currentMission) return;
    setCompleting(true); setError("");
    const isCity = currentMission.missionType === "city_outing";
    const isNight = currentMission.missionType === "indoor_audio_break";
    try {
      await completeMission({ missionId: currentMission.missionId, photoLabel: isCity ? "City wander" : isNight ? "Quiet reset" : "Nature break", photoEmoji: isCity ? "🌆" : isNight ? "☕" : "🌿", photoTone: isCity ? "sunset" : isNight ? "sky" : "earth", caption, photoData });
      setComposingPost(false);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not post your completed break."); }
    finally { setCompleting(false); }
  }

  return <main className="min-h-screen bg-[#f6f5eb] text-[#243b2d]"><header className="border-b-2 border-[#344a36] bg-[#fbfaf2]"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4"><Link href="/" className="flex items-center gap-2 font-mono text-sm font-black tracking-widest"><Sprout/> MAATI</Link><div className="flex items-center gap-4"><Link href="/" className="flex items-center gap-1 text-xs font-bold text-[#647551]"><ArrowLeft size={14}/> COMMUNITY</Link><button onClick={() => void signOut()} className="flex items-center gap-1 text-xs text-[#788373]"><LogOut size={14}/> SIGN OUT</button></div></div></header>
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-7"><div><p className="font-mono text-[10px] font-bold tracking-[.2em] text-[#74816d]">{data?.user.username ? `@${data.user.username}` : "YOUR ACCOUNT"}</p><h1 className="mt-2 text-3xl font-black">{profileMissing ? "Set up your profile" : "Your profile & scrapbook"}</h1><p className="mt-2 text-sm text-[#788373]">Your preferences and completed break records are stored in your Maati account.</p></div>
      {error && <p role="alert" className="border-2 border-red-300 bg-white p-3 text-sm text-red-800">{error}</p>}
      {(!data || editing) ? <form onSubmit={e => void save(e)} className="border-2 border-[#344a36] bg-[#fffdf6] p-5 shadow-[4px_4px_0_#344a36] sm:p-7"><h2 className="text-xl font-black">Your break preferences</h2><p className="mt-1 text-sm text-[#788373]">We use your area as the route start and these choices to personalize nearby outings.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">HOME AREA<input required maxLength={100} value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} placeholder="e.g. Kothrud" className="mt-1 w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm font-normal"/></label><label className="text-xs font-bold">CITY<input required maxLength={100} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="mt-1 w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm font-normal"/></label></div>
        <div className="mt-5 grid gap-4 md:grid-cols-3"><label className="text-xs font-bold">GETTING AROUND<select value={form.transportMode} onChange={e => setForm({ ...form, transportMode: e.target.value as TransportMode })} className="mt-1 block w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm"><option value="ebus">Bus / public transit</option><option value="walk">Walking</option><option value="auto">Auto / car</option></select></label><label className="text-xs font-bold">REFUEL PREFERENCE<select value={form.refuelPreference} onChange={e => setForm({ ...form, refuelPreference: e.target.value as RefuelPreference })} className="mt-1 block w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm"><option value="tea_coffee">Tea or coffee</option><option value="high_protein_veg_snacks">High-protein vegetarian snack</option><option value="cool_drinks">Cool drink</option></select></label><label className="text-xs font-bold">YOUR OUTING VIBE<select value={form.vibe} onChange={e => setForm({ ...form, vibe: e.target.value as VibePreference })} className="mt-1 block w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm"><option value="nature">Nature & fresh air</option><option value="urban">Lively city spots</option><option value="quiet">Quiet places</option></select></label></div>
        <fieldset className="mt-5"><legend className="text-xs font-bold">PLACES YOU LIKE</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{PLACE_CHOICES.map(place => <label key={place.id} className="flex items-center gap-2 border border-[#d8dece] bg-white px-3 py-2 text-xs"><input type="checkbox" checked={form.placePreferences.includes(place.id)} onChange={() => togglePlace(place.id)} className="accent-[#58714e]"/>{place.label}</label>)}</div></fieldset><button disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 border-2 border-[#344a36] bg-[#dce9cd] px-4 py-3 font-mono text-xs font-black shadow-[4px_4px_0_#344a36]"><Save size={15}/>{busy ? "SAVING…" : "SAVE PREFERENCES"}</button>{!profileMissing && <button type="button" onClick={() => { setForm(data!.profile!); setEditing(false); }} className="mt-3 w-full text-xs text-[#788373] underline">Cancel</button>}</form> : <><section className="flex flex-wrap items-center justify-between gap-3 border border-[#cbd3c1] bg-[#fffdf6] p-4"><p className="text-sm text-[#465347]">Based in <b>{data.profile!.area}, {data.profile!.city}</b> · {data.profile!.transportMode === "ebus" ? "public transit" : data.profile!.transportMode} · {data.profile!.vibe} outings</p><button onClick={() => setEditing(true)} className="border-2 border-[#344a36] bg-[#e5efd7] px-3 py-2 font-mono text-[10px] font-bold">EDIT PREFERENCES</button></section>
       <section className="flex flex-wrap items-center justify-between gap-3 border border-[#cbd3c1] bg-[#fffdf6] p-4"><div><p className="font-mono text-[10px] font-black tracking-wider">DESKTOP BREAK COMPANION</p><p className="mt-1 text-xs text-[#788373]">Install Maati Desktop, then open its floating tree from this device.</p></div><a href="maati://open" className="inline-flex items-center gap-2 border-2 border-[#344a36] bg-[#e5efd7] px-3 py-2 font-mono text-[10px] font-bold"><ExternalLink size={13}/> OPEN DESKTOP COMPANION</a></section>
       {currentMission && <section className="border-2 border-[#344a36] bg-[#eaf1df] p-5 shadow-[4px_4px_0_#344a36]"><p className="font-mono text-[10px] font-bold tracking-[.2em] text-[#647551]">ACCEPTED MISSION · {currentMission.missionType.replaceAll("_", " ").toUpperCase()}</p><p className="mt-2 font-semibold">{currentMission.message}</p>{currentMission.missionType === "plant_seed" && <SeedPlantingGuide/>}{!composingPost ? <button disabled={completing} onClick={() => setComposingPost(true)} className="mt-4 border-2 border-[#344a36] bg-[#fffdf6] px-4 py-2 font-mono text-[10px] font-black shadow-[3px_3px_0_#344a36]">MARK MISSION DONE & POST TO FEED</button> : <div className="mt-4"><PostComposer tone="light" busy={completing} buttonLabel="COMPLETE MISSION & POST" onSubmit={finishMission}/></div>}</section>}
       {itinerary ? <section className="border-2 border-[#344a36] bg-[#fffdf6] p-5 shadow-[5px_5px_0_#344a36] sm:p-7"><p className="font-mono text-[10px] font-bold tracking-[.2em] text-[#74816d]">{itinerary.status.toUpperCase()} MISSION · {itinerary.city.toUpperCase()}</p><h2 className="mt-2 text-2xl font-black">{itinerary.place.name}</h2><p className="mt-1 text-sm text-[#788373]">{itinerary.place.category} · {itinerary.place.distanceKm} km away · {itinerary.message}</p><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="border border-[#d8dece] bg-[#f7f7ed] p-4"><h3 className="flex items-center gap-2 font-mono text-xs font-black"><MapPin size={14}/> START TO FINISH</h3><p className="mt-3 text-sm"><b>Start:</b> {itinerary.origin}</p><p className="mt-1 text-sm"><b>Destination:</b> {itinerary.place.name}, {itinerary.city}</p><p className="mt-1 text-sm"><b>Mode:</b> {itinerary.transportMode === "ebus" ? "Public bus / transit" : itinerary.transportMode}</p>{itinerary.routeDuration && <p className="mt-1 text-sm"><b>Estimated time:</b> {itinerary.routeDuration}</p>}{itinerary.transitAlternatives?.length ? <div className="mt-4 space-y-3 border-t border-dashed pt-3">{itinerary.transitAlternatives.map((route,i)=><div key={i} className="border bg-white p-3"><b className="font-mono text-[10px]">ROUTE {i+1}{route.duration ? ` · ${route.duration}` : ""}</b><ol className="mt-2 space-y-2">{route.legs.map((leg,j)=><li key={j} className="text-sm"><b className="text-[10px]">{leg.mode} {leg.line ? `· ${leg.line}` : ""}</b><p>Board: {leg.boardAt || "See live route"} → Get off: {leg.getOffAt || "See live route"}</p></li>)}</ol></div>)}</div> : <p className="mt-3 text-xs text-[#788373]">Open the live route for current bus services and exact stops. Maati will not guess route numbers or stations.</p>}<a className="mt-4 inline-flex items-center gap-2 border-2 border-[#344a36] bg-[#e5efd7] px-3 py-2 font-mono text-[10px] font-bold" href={itinerary.directionsUrl} target="_blank" rel="noreferrer">OPEN TRANSIT DIRECTIONS <ExternalLink size={13}/></a></div><div className="border border-[#d8dece] bg-[#f7f7ed] p-4"><h3 className="font-mono text-xs font-black">ACTIVITIES TO TRY</h3><ul className="mt-3 space-y-2 text-sm">{itinerary.place.suggestedActivities?.map(activity=><li key={activity}>✦ {activity}</li>)}</ul><p className="mt-4 border-t border-dashed pt-3 font-mono text-[9px] text-[#899184]">SAVED {new Date(itinerary.preparedAt).toLocaleString()}</p></div></div></section> : <section className="border-2 border-dashed border-[#aab59d] bg-[#fffdf6] p-5 text-sm text-[#788373]">Your next accepted outing and its route guide will appear here.</section>}
       <ScrapbookGrid stats={data.stats} badges={data.badges}/></>}
      <p className="pb-8 text-center font-mono text-[9px] text-[#899184]">{!data ? "LOADING ACCOUNT…" : `${data.stats.breaksCompleted} COMPLETED BREAKS · PRIVATE TO YOUR ACCOUNT`}</p></div></main>;
}
