"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, LoaderCircle, MapPin, SkipForward, X } from "lucide-react";
import { acceptMission, completeMission, getAdvice, getBreakState, getMe, getNearbyPlaces, getSession, saveBreakState, syncScreenTime, type AdviceResponse } from "@/lib/api";
import type { MaatiProfile, PlaceRecommendation, SavedItinerary } from "@/lib/profile";
import BreakAudioPlayer from "@/components/BreakAudioPlayer";
import PostComposer from "@/components/PostComposer";

const FIRST_BREAK_THRESHOLD = 10_800; // Three hours of active screen time.
const FOLLOW_UP_BREAK_INTERVAL = 7_200;
const NO_RESPONSE_MS = 5 * 60 * 1000;
const DIM_DURATION_MS = 10 * 60 * 1000;
const FALLBACK_PROFILE: MaatiProfile = { area: "Pune", city: "Pune", transportMode: "ebus", refuelPreference: "tea_coffee", vibe: "nature", placePreferences: ["parks", "cafes"] };
const PETALS = [
  { left: "8%", size: 7, delay: 0, duration: 7, drift: 30 }, { left: "25%", size: 5, delay: 1.7, duration: 8, drift: -26 },
  { left: "42%", size: 8, delay: 3.1, duration: 7.5, drift: 34 }, { left: "61%", size: 6, delay: .9, duration: 8.5, drift: -32 },
  { left: "78%", size: 5, delay: 4.2, duration: 7.2, drift: 28 }, { left: "92%", size: 7, delay: 2.4, duration: 8.2, drift: -24 },
];
interface ScreenSnapshot { date: string; seconds: number }
interface InputRegion { x: number; y: number; width: number; height: number }
type BreakVerification = { verified: boolean; reason: string };
declare global { interface Window { maatiWidget?: { setInputRegions(regions: InputRegion[]): void; getScreenTime(): Promise<ScreenSnapshot>; resetScreenTime(): Promise<ScreenSnapshot>; startDim(durationMs: number): Promise<void>; stopDim(): Promise<void>; verifyBreak(): Promise<BreakVerification>; openProfile(route?: "/auth" | "/profile" | "/profile?setup=1"): Promise<void>; onScreenTimeUpdate(callback: (snapshot: ScreenSnapshot) => void): () => void } } }
type Stage = "first" | "follow-up" | null;
type MissionType = "plant_seed" | "nature_sidequest" | "city_outing" | "indoor_audio_break";
type TestMode = "day" | "evening" | "night";
type AccountStatus = "checking" | "ready" | "signed-out" | "setup";

function timeLabel(seconds: number) { return [Math.floor(seconds/3600), Math.floor(seconds%3600/60), seconds%60].map(n=>String(n).padStart(2,"0")).join(":"); }
function localTime() { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date()); }
function dateKey() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function photoStyle(type: string): [string, string, "leaf" | "sunset" | "sky" | "earth"] { return type === "city_outing" ? ["City wander", "🌆", "sunset"] : type === "indoor_audio_break" ? ["Quiet reset", "☕", "sky"] : type === "plant_seed" ? ["Seed planted", "🌱", "leaf"] : ["Nature break", "🌿", "earth"]; }

export default function CherryBlossomCompanion({ isOpen, onOpenChange, onMissionComplete }: { isOpen: boolean; onOpenChange(open: boolean): void; onMissionComplete(): void }) {
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const [nextThreshold, setNextThreshold] = useState(FIRST_BREAK_THRESHOLD);
  const [stage, setStage] = useState<Stage>(null);
  const [profile, setProfile] = useState<MaatiProfile>(FALLBACK_PROFILE);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("checking");
  const [advice, setAdvice] = useState<AdviceResponse|null>(null);
  const [places, setPlaces] = useState<PlaceRecommendation[]>([]);
  const [chosen, setChosen] = useState<PlaceRecommendation|null>(null);
  const [itinerary, setItinerary] = useState<SavedItinerary|null>(null);
  const [missionId, setMissionId] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [error, setError] = useState("");
  const [dimUntil, setDimUntil] = useState<number|null>(null);
  const [remainingDim, setRemainingDim] = useState(0);
  const [ignoreSeconds, setIgnoreSeconds] = useState(0);
  const [showComposer, setShowComposer] = useState(false);
  const [verification, setVerification] = useState<"not-started" | "checking" | "verified" | "penalty">("not-started");
  const [testMode, setTestMode] = useState<TestMode | null>(null);
  const treeRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const responseTimerRef = useRef<number|null>(null);
  const placesRequestRef = useRef(false);
  const promptedRef = useRef<number|null>(null);
  const scheduleDateRef = useRef<string|null>(null);
  const lastScreenSyncRef = useRef(0);
  const due = ready && seconds >= nextThreshold;
  const cityMission = advice?.mission_type === "city_outing";

  const loadProfile = useCallback(async () => {
    try {
      const session=await getSession();
      if(!session.user){setAccountStatus("signed-out");return;}
      if(!session.profile){setAccountStatus("setup");return;}
      setProfile(session.profile);setAccountStatus("ready");
    } catch { setAccountStatus("checking"); }
  }, []);
  const clearMission = useCallback(() => { setAdvice(null); setPlaces([]); setChosen(null); setItinerary(null); setMissionId(null); setError(""); setLoading(false); setPlacesLoading(false); setStage(null); setShowComposer(false); setVerification("not-started"); }, []);
  const startDim = useCallback(async () => { const until=Date.now()+DIM_DURATION_MS; setDimUntil(until); setRemainingDim(Math.ceil(DIM_DURATION_MS/1000)); await window.maatiWidget?.startDim(DIM_DURATION_MS); }, []);
  const stopDim = useCallback(async () => { setDimUntil(null); setRemainingDim(0); await window.maatiWidget?.stopDim(); }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => { if(accountStatus==="ready")return; const id=window.setInterval(()=>void loadProfile(),15_000); return ()=>window.clearInterval(id); },[accountStatus,loadProfile]);
  useEffect(() => {
    const tracker=window.maatiWidget;
    let mounted=true;
    const apply=(s:ScreenSnapshot)=>{
      if(!mounted||!Number.isFinite(s?.seconds)) return;
      const date=s.date||dateKey(); setSeconds(s.seconds);
      if(Date.now()-lastScreenSyncRef.current>=60_000){lastScreenSyncRef.current=Date.now();void syncScreenTime(date,s.seconds).catch(()=>{});}
      if(scheduleDateRef.current===date) return;
      scheduleDateRef.current=date; setReady(false);
      void getBreakState(date).then(schedule=>{ if(!mounted)return; setNextThreshold(Number.isFinite(schedule.nextThreshold) ? schedule.nextThreshold : FIRST_BREAK_THRESHOLD); setReady(true); }).catch(()=>{ if(!mounted)return; setNextThreshold(FIRST_BREAK_THRESHOLD); setReady(true); });
    };
    if(!tracker) {
      apply({date:dateKey(),seconds:0});
      const id=window.setInterval(()=>setSeconds(current=>{ const next=current+1; if(Date.now()-lastScreenSyncRef.current>=60_000){lastScreenSyncRef.current=Date.now();void syncScreenTime(dateKey(),next).catch(()=>{});} return next; }),1000);
      return ()=>{mounted=false;window.clearInterval(id);};
    }
    const off=tracker.onScreenTimeUpdate(apply); tracker.getScreenTime().then(apply).catch(()=>setReady(true));
    return ()=>{mounted=false;off();};
  }, []);

  const loadNearbyPlaces = useCallback(async () => {
    if (placesRequestRef.current) return;
    placesRequestRef.current = true;
    setPlacesLoading(true);
    setError("");
    try {
      const nearby = await getNearbyPlaces();
      setPlaces(nearby.recommendations);
      if (!nearby.recommendations.length) setError("No new places were found nearby. You can still explore a place you like.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find nearby places.");
    } finally {
      placesRequestRef.current = false;
      setPlacesLoading(false);
    }
  }, []);

  const fetchMission = useCallback(async (mode?: TestMode, force = false) => {
    if(loading||(advice&&!force)) return;
    if(force){setAdvice(null);setPlaces([]);setChosen(null);setItinerary(null);setMissionId(null);setShowComposer(false);}
    setLoading(true); setError("");
    try {
      const time = mode === "day" ? "16:30" : mode === "evening" ? "18:00" : mode === "night" ? "20:00" : localTime();
      const result=await getAdvice({ seedType:mode === "day" ? "basil" : "No seed", location:profile.city, viabilityScore:mode === "day" ? 90 : null, weather:mode === "day" ? { temperature: 24, humidity: 55 } : {}, localTime:time });
      setAdvice(result);
      if(result.mission_type === "city_outing") await loadNearbyPlaces();
    } catch(e) { setError(e instanceof Error ? e.message : "Could not load your break mission."); }
    finally { setLoading(false); }
  }, [advice, loading, profile.city, loadNearbyPlaces]);

  useEffect(() => {
    if (!missionId || loading) return;
    const syncRemoteCompletion = async () => {
      try {
        const current = await getMe();
        if (current.currentMission?.missionId === missionId) return;
        const tracker = window.maatiWidget;
        if (tracker) {
          const snapshot = await tracker.resetScreenTime();
          setSeconds(snapshot.seconds);
          await syncScreenTime(snapshot.date, snapshot.seconds).catch(() => {});
        } else {
          setSeconds(0);
          await syncScreenTime(dateKey(), 0).catch(() => {});
        }
        const schedule = { date: dateKey(), nextThreshold: FIRST_BREAK_THRESHOLD, skippedFirst: false };
        await saveBreakState(schedule).catch(() => {});
        scheduleDateRef.current = schedule.date;
        setNextThreshold(FIRST_BREAK_THRESHOLD);
        promptedRef.current = null;
        clearMission();
        onOpenChange(false);
        onMissionComplete();
      } catch { /* Keep the accepted mission visible and retry on the next poll. */ }
    };
    const timer = window.setInterval(() => void syncRemoteCompletion(), 4000);
    return () => window.clearInterval(timer);
  }, [missionId, loading, clearMission, onOpenChange, onMissionComplete]);

  useEffect(() => {
    if(due&&accountStatus!=="ready"){onOpenChange(true);return;}
    if(!due||accountStatus!=="ready"||promptedRef.current===nextThreshold) return;
    promptedRef.current=nextThreshold; setStage(nextThreshold===FIRST_BREAK_THRESHOLD?"first":"follow-up"); clearMission();
    setStage(nextThreshold===FIRST_BREAK_THRESHOLD?"first":"follow-up"); onOpenChange(true); void fetchMission();
  }, [due,accountStatus,nextThreshold,onOpenChange,fetchMission,clearMission]);

  useEffect(() => {
    const regions=[treeRef.current,isOpen?bubbleRef.current:null,advice?.audio_theme?audioRef.current:null].filter((el):el is HTMLElement=>el!==null).map(el=>{ const r=el.getBoundingClientRect(); return {x:Math.floor(r.left)-8,y:Math.floor(r.top)-8,width:Math.ceil(r.width)+16,height:Math.ceil(r.height)+16}; });
    window.maatiWidget?.setInputRegions(regions);
  }, [isOpen,advice,places,chosen,itinerary,loading,error,dimUntil]);

  useEffect(() => { if(!dimUntil)return; const tick=()=>{ const left=Math.max(0,dimUntil-Date.now()); setRemainingDim(Math.ceil(left/1000)); if(left===0){setDimUntil(null);void window.maatiWidget?.stopDim();} }; tick(); const id=window.setInterval(tick,1000); return ()=>window.clearInterval(id); },[dimUntil]);
  useEffect(() => {
    if(stage!=="follow-up"||missionId||!due)return;
    const deadline=Date.now()+NO_RESPONSE_MS;setIgnoreSeconds(Math.ceil(NO_RESPONSE_MS/1000));
    responseTimerRef.current=window.setInterval(()=>{
      const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));setIgnoreSeconds(left);
      if(left===0){if(responseTimerRef.current)clearInterval(responseTimerRef.current);responseTimerRef.current=null;void startDim();}
    },1000);
    return ()=>{if(responseTimerRef.current)clearInterval(responseTimerRef.current);responseTimerRef.current=null;};
  },[stage,missionId,due,startDim]);
  async function skip() {
    const follow=stage==="follow-up";
    const schedule={date:dateKey(),nextThreshold:Math.min(86_400,seconds+FOLLOW_UP_BREAK_INTERVAL),skippedFirst:!follow||nextThreshold>FIRST_BREAK_THRESHOLD};
    try { await saveBreakState(schedule); } catch(e) { setError(e instanceof Error?e.message:"Could not save your break reminder."); return; }
    setNextThreshold(schedule.nextThreshold);promptedRef.current=null;clearMission();onOpenChange(false);
    if(follow) void startDim();
  }
  function clickTree() { if(due){onOpenChange(true);if(accountStatus==="ready"&&!advice&&!loading)void fetchMission();}else onOpenChange(!isOpen); }
  async function openAccount() { const route=accountStatus==="signed-out"?"/auth":"/profile?setup=1";if(window.maatiWidget)await window.maatiWidget.openProfile(route);else window.location.assign(route); }

  async function accept(place?:PlaceRecommendation) {
    if(!advice) return;
    if(cityMission&&!place){setError("Choose one of the nearby places first.");return;}
    setLoading(true);setError("");
    try { const result=await acceptMission({missionType:advice.mission_type as MissionType,message:advice.message,badgeId:advice.scrapbook_badge_id,...(place?{place}:{})}); setMissionId(result.missionId);setChosen(place||null);setItinerary(result.itinerary);setVerification(window.maatiWidget?"checking":"not-started"); if(window.maatiWidget) { void window.maatiWidget.verifyBreak().then(result=>setVerification(result.verified?"verified":"penalty")).catch(()=>setVerification("not-started")); await window.maatiWidget.openProfile(); } }
    catch(e){setError(e instanceof Error?e.message:"Could not save mission.");}
    finally{setLoading(false);}
  }
  async function finish(caption: string, photoData: string | null) {
    if(!missionId||!advice)return;setLoading(true);setError("");const [photoLabel,photoEmoji,photoTone]=photoStyle(advice.mission_type);
    try { await completeMission({missionId,photoLabel,photoEmoji,photoTone,caption,photoData}); onMissionComplete(); const tracker=window.maatiWidget;if(tracker){const snapshot=await tracker.resetScreenTime();setSeconds(snapshot.seconds);await syncScreenTime(snapshot.date,snapshot.seconds).catch(()=>{});}else {setSeconds(0);await syncScreenTime(dateKey(),0).catch(()=>{});}const schedule={date:dateKey(),nextThreshold:FIRST_BREAK_THRESHOLD,skippedFirst:false};try { await saveBreakState(schedule); } catch { setError("Post saved. Break reminder could not sync to your account."); } scheduleDateRef.current=schedule.date;setNextThreshold(FIRST_BREAK_THRESHOLD);promptedRef.current=null;clearMission();onOpenChange(false); }
    catch(e){setError(e instanceof Error?e.message:"Could not post the completed mission.");}finally{setLoading(false);}
  }

  return <>
    {dimUntil&&<div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] bg-black/45"/>}
    <AnimatePresence>{isOpen&&<motion.aside ref={bubbleRef} key="break-bubble" initial={{opacity:0,y:8,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:6,scale:.97}} className="fixed bottom-64 right-2 z-[95] max-h-[50vh] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto border-2 border-gray-700 bg-black p-2.5 font-mono text-[10px] leading-snug text-green-400 shadow-[3px_3px_0_#111]" role="dialog" aria-label="Break mission">
      <div className="space-y-2"><div className="flex items-center justify-between border-b border-gray-700 pb-1.5"><p className="text-[9px] font-bold tracking-widest text-green-300">{stage=== "follow-up"?"FOLLOW-UP BREAK":"BREAK COMPANION"} · {profile.city.toUpperCase()}</p><button onClick={()=>onOpenChange(false)} aria-label="Close" className="text-gray-400"><X size={13}/></button></div>
        {process.env.NODE_ENV !== "production"&&!missionId&&<details className="border border-amber-800 bg-amber-950/40 p-1.5 text-amber-200"><summary className="cursor-pointer text-[8px] font-bold tracking-wider">DEV TEST MODES{testMode?` · ${testMode.toUpperCase()}`:""}</summary><div className="mt-1.5 grid grid-cols-3 gap-1">{([['day','DAY · PLANT'],['evening','EVENING · TRIP'],['night','NIGHT · AUDIO']] as const).map(([mode,label])=><button key={mode} onClick={()=>{setTestMode(mode);setStage("first");onOpenChange(true);void fetchMission(mode,true);}} className="border border-amber-800 px-1 py-1 text-[7px] font-bold">{label}</button>)}</div><p className="mt-1 text-[7px] text-amber-500">Day uses basil + a test viability score; all advice still comes from Backboard.</p></details>}
        {accountStatus!=="ready"&&<div className="space-y-2 border border-green-900 p-2"><p>{accountStatus==="signed-out"?"Sign in to save your missions and profile.":accountStatus==="setup"?"Finish your profile setup before starting a mission.":"Checking your Maati account…"}</p>{accountStatus!=="checking"&&<button onClick={()=>void openAccount()} className="w-full border-2 border-green-700 bg-green-950 px-2 py-1.5 text-[9px] font-bold uppercase text-green-200">{accountStatus==="signed-out"?"SIGN IN":"COMPLETE PROFILE"}</button>}{accountStatus==="checking"&&<button onClick={()=>void loadProfile()} className="w-full border border-green-800 px-2 py-1 text-[9px] uppercase">RETRY ACCOUNT CHECK</button>}</div>}
        {advice&&<><p>{cityMission&&!chosen?"Choose one nearby outing. Accepting saves its route guide to your profile.":advice.message}</p>{advice.audio_theme&&<p className="text-[9px] text-green-700">REFUEL: {profile.refuelPreference.replaceAll("_"," ").toUpperCase()}</p>}<p className="text-[9px] text-green-700">BADGE · {advice.scrapbook_badge_id}</p></>}
        {loading&&<p className="flex items-center gap-2"><LoaderCircle size={13} className="animate-spin"/>{advice?"SAVING MISSION…":"FETCHING BREAK MISSION…"}</p>}
        {placesLoading&&<p className="flex items-center gap-2"><LoaderCircle size={13} className="animate-spin"/>FINDING THREE NEARBY PLACES…</p>}
        {cityMission&&!chosen&&places.length>0&&<div className="space-y-1.5"><p className="text-[9px] font-bold uppercase text-green-300">Nearest new places · choose one</p>{places.map((place,index)=><button key={place.id} onClick={()=>setChosen(place)} className="block w-full border border-green-900 p-2 text-left hover:bg-green-950"><span className="block font-bold">{index+1}. {place.name}</span><span className="text-[9px] text-green-700">{place.category} · {place.distanceKm} km · {place.shortPitch}</span></button>)}<p className="text-[8px] text-green-800">Place data © OpenStreetMap contributors</p></div>}
        {cityMission&&chosen&&!missionId&&<div className="border border-green-800 bg-green-950/50 p-2"><b>{chosen.name}</b><p>{profile.area}, {profile.city} → {chosen.name}</p><p>{chosen.suggestedActivities?.slice(0,2).join(" · ")}</p><button onClick={()=>void accept(chosen)} disabled={loading} className="mt-2 w-full border-2 border-green-700 bg-green-950 px-2 py-1.5 text-[9px] font-bold uppercase text-green-200"><Check size={12} className="mr-1 inline"/>Accept outing & save route</button></div>}
        {advice&&!cityMission&&!missionId&&<button onClick={()=>void accept()} disabled={loading} className="flex w-full items-center justify-center gap-1.5 border-2 border-green-700 bg-green-950 px-2 py-1.5 text-[9px] font-bold uppercase text-green-300"><Check size={14}/> Accept mission</button>}
        {missionId&&<div className="space-y-2 border border-green-800 bg-green-950/50 p-2"><p className="font-bold text-green-200">MISSION SAVED TO YOUR PROFILE</p>{verification!=="not-started"&&<p className="text-[9px] text-green-300">{verification==="checking"?"DESKTOP BREAK CHECK · KEEP THE CURSOR STILL FOR 5 MINUTES":verification==="verified"?"BREAK VERIFIED · NO INPUT FOR 5 MINUTES":"CURSOR OR INPUT DETECTED · 10-MINUTE DIM APPLIED"}</p>}{itinerary&&<><p>{itinerary.origin} → {itinerary.place.name}</p><p>{itinerary.routeDuration||"Live transit route"} · {itinerary.transitLegs.length?`${itinerary.transitLegs.length} transit leg(s)`:"see Maps for current stops"}</p><a href={itinerary.directionsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline"><ExternalLink size={12}/>Open live directions</a></>}{!showComposer?<button onClick={()=>setShowComposer(true)} disabled={loading} className="flex w-full items-center justify-center gap-1.5 border-2 border-green-700 px-2 py-1.5 text-[9px] font-bold uppercase"><Check size={13}/>Mark task complete & post</button>:<PostComposer busy={loading} buttonLabel="COMPLETE MISSION & POST" onSubmit={finish}/>}</div>}
        {error&&<p role="alert" className="break-words text-[9px] text-red-400">{error}</p>}{error&&!loading&&<button disabled={placesLoading} onClick={()=>advice?.mission_type==="city_outing"?void loadNearbyPlaces():void fetchMission()} className="w-full border border-green-800 px-2 py-1 text-[9px] uppercase disabled:opacity-50">{placesLoading?"RETRYING…":"Retry"}</button>}
        {stage==="follow-up"&&!missionId&&<p className="text-[8px] text-amber-300">NO RESPONSE IN {timeLabel(ignoreSeconds)} · THEN SOFT DIM FOR 10 MIN</p>}
        {stage&&<button onClick={()=>void skip()} className="flex w-full items-center justify-center gap-1 border border-gray-700 px-2 py-1.5 text-[9px] uppercase text-gray-300 hover:bg-gray-900"><SkipForward size={12}/>{stage==="first"?"Skip · remind me in 2 hours":"Skip · dim display for 10 min"}</button>}
        {dimUntil&&<div className="flex items-center justify-between border border-gray-700 p-2 text-[9px] text-gray-300"><span>SOFT DIM · {timeLabel(remainingDim)}</span><button onClick={()=>void stopDim()} className="flex items-center gap-1 underline"><X size={11}/>Dismiss</button></div>}
      </div>
    </motion.aside>}</AnimatePresence>
    {advice?.audio_theme&&<div ref={audioRef} className={`fixed ${isOpen?"bottom-2":"bottom-64"} right-2 z-[96] w-[min(18rem,calc(100vw-1rem))]`}><BreakAudioPlayer compact={!isOpen}/></div>}
    <motion.button ref={treeRef} type="button" aria-label={due?"Open your screen break mission":"Show screen time"} onClick={clickTree} whileHover={{scale:1.02}} className="fixed bottom-2 right-2 z-[94] flex h-[232px] w-56 items-center justify-center overflow-hidden border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-green-400">
      <img src="/tree.png" alt="Cherry Blossom" draggable={false} className="absolute left-[-212px] top-[-111px] h-[384px] w-[672px] max-w-none select-none"/>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {PETALS.map((p,i)=><motion.span key={i} className="absolute rounded-[80%_20%_80%_20%] bg-pink-300 shadow-[0_0_5px_rgba(255,190,220,0.65)]" style={{left:p.left,top:-p.size,width:p.size,height:p.size*1.5}} animate={{x:[0,p.drift,-p.drift*.45,p.drift*.7],y:[0,90,175,250],rotate:[0,140,260,420],opacity:[0,.95,.8,0]}} transition={{duration:p.duration,delay:-p.delay,repeat:Infinity,ease:"linear"}}/>)}
      </span>
    </motion.button>
    {!isOpen&&<div className="pointer-events-none fixed bottom-2 right-2 z-[93] translate-y-[-13rem] border-2 border-gray-700 bg-black px-2 py-1 font-mono text-[9px] text-green-400">SCREEN TIME {timeLabel(seconds)}{due?" · BREAK DUE":""}</div>}
  </>;
}
