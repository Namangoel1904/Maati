"use client";

import { useEffect, useState } from "react";
import { AudioLines, Pause, Play, Volume2 } from "lucide-react";

type Ambient = "forest" | "rain" | "ocean" | "city";
const AMBIENTS: { id: Ambient; label: string }[] = [
  { id: "forest", label: "Forest & birds" }, { id: "rain", label: "Rain" },
  { id: "ocean", label: "Ocean waves" }, { id: "city", label: "City traffic" },
];

function startSound(kind: "lofi" | Ambient) {
  const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new Error("Audio playback is not supported in this browser.");
  const ctx = new Context();
  const master = ctx.createGain(); master.gain.value = 0.18; master.connect(ctx.destination);
  const timers: number[] = [];
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;

  if (kind === "lofi") {
    const chords = [[261.63, 329.63, 392, 493.88], [220, 261.63, 329.63, 392], [174.61, 220, 261.63, 349.23], [196, 246.94, 293.66, 392]];
    let beat = 0;
    const note = (frequency: number, when: number, length: number, volume: number, wave: OscillatorType = "triangle") => {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      osc.type = wave; osc.frequency.value = frequency; filter.type = "lowpass"; filter.frequency.value = 1800;
      gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(volume, when + 0.025); gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
      osc.connect(filter); filter.connect(gain); gain.connect(master); osc.start(when); osc.stop(when + length + 0.03);
    };
    const tick = () => {
      const now = ctx.currentTime + 0.03, bar = Math.floor(beat / 8) % chords.length, chord = chords[bar];
      if (beat % 8 === 0) chord.forEach((hz, i) => note(hz, now, 1.65, i === 0 ? 0.12 : 0.07));
      note(chord[(beat * 3) % chord.length] / 2, now, 0.42, 0.12, "sine");
      if (beat % 4 === 0) note(58, now, 0.16, 0.18, "sine");
      if (beat % 4 === 2) note(170, now, 0.08, 0.05, "square");
      beat++;
    };
    tick(); timers.push(window.setInterval(tick, 500));
    const vinyl = ctx.createBufferSource(), vinylGain = ctx.createGain(), vinylFilter = ctx.createBiquadFilter();
    vinyl.buffer = noiseBuffer; vinyl.loop = true; vinylFilter.type = "highpass"; vinylFilter.frequency.value = 4500; vinylGain.gain.value = 0.018;
    vinyl.connect(vinylFilter); vinylFilter.connect(vinylGain); vinylGain.connect(master); vinyl.start();
  } else {
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = noiseBuffer; source.loop = true;
    filter.type = kind === "rain" ? "highpass" : kind === "ocean" ? "lowpass" : kind === "city" ? "lowpass" : "lowpass";
    filter.frequency.value = kind === "rain" ? 900 : kind === "ocean" ? 350 : kind === "city" ? 260 : 600;
    filter.Q.value = kind === "rain" ? 0.35 : 0.7; gain.gain.value = kind === "rain" ? 0.28 : kind === "city" ? 0.35 : 0.42;
    source.connect(filter); filter.connect(gain); gain.connect(master); source.start();
    if (kind === "ocean" || kind === "forest") {
      const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = kind === "ocean" ? 0.09 : 0.035; depth.gain.value = kind === "ocean" ? 0.22 : 0.12;
      lfo.connect(depth); depth.connect(gain.gain); lfo.start();
    }
    if (kind === "forest") {
      const chirp = () => {
        const osc = ctx.createOscillator(), env = ctx.createGain(), pan = ctx.createStereoPanner();
        const start = ctx.currentTime + 0.03, base = 2200 + Math.random() * 1300;
        osc.type = "sine"; osc.frequency.setValueAtTime(base, start); osc.frequency.exponentialRampToValueAtTime(base * 1.35, start + 0.09);
        env.gain.setValueAtTime(0.0001, start); env.gain.exponentialRampToValueAtTime(0.11, start + 0.025); env.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
        pan.pan.value = Math.random() * 1.6 - 0.8; osc.connect(env); env.connect(pan); pan.connect(master); osc.start(start); osc.stop(start + 0.2);
      };
      timers.push(window.setInterval(chirp, 1100 + Math.random() * 900));
    }
  }
  void ctx.resume();
  return () => { timers.forEach(window.clearInterval); void ctx.close(); };
}

export default function BreakAudioPlayer({ compact = false }: { compact?: boolean }) {
  const [kind, setKind] = useState<"lofi" | Ambient>("lofi");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!playing) return;
    try { setError(""); return startSound(kind); }
    catch (e) { setPlaying(false); setError(e instanceof Error ? e.message : "Could not start audio."); }
  }, [playing, kind]);
  if (compact) return <div className="flex items-center justify-between gap-2 border-2 border-gray-700 bg-black px-2 py-1.5 font-mono text-green-300 shadow-[2px_2px_0_#111]"><span className="flex min-w-0 items-center gap-1.5 truncate text-[8px] font-bold uppercase"><AudioLines size={12}/>{kind === "lofi" ? "Lofi" : AMBIENTS.find(item => item.id === kind)?.label}</span><button aria-label={playing ? "Pause audio" : "Play audio"} onClick={() => setPlaying(value => !value)} className="flex shrink-0 items-center gap-1 border border-green-700 bg-green-950 px-2 py-1 text-[8px] font-bold uppercase">{playing ? <Pause size={11}/> : <Play size={11}/>} {playing ? "Pause" : "Play"}</button></div>;
  return <div className="space-y-2 border border-gray-700 bg-gray-950 p-2 text-green-300">
    <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase"><AudioLines size={13}/> 10-minute audio break</div>
    <div className="grid grid-cols-2 gap-1"><button onClick={() => { setKind("lofi"); setPlaying(false); }} aria-pressed={kind === "lofi"} className={`border px-1.5 py-1 text-[8px] ${kind === "lofi" ? "border-green-500 bg-green-950" : "border-gray-700"}`}>Lofi song</button><select aria-label="Ambient sound" value={kind === "lofi" ? "forest" : kind} onChange={e => { setKind(e.target.value as Ambient); setPlaying(false); }} className="min-w-0 border border-gray-700 bg-black px-1 py-1 text-[8px] text-green-300">{AMBIENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
    <button onClick={() => setPlaying(value => !value)} className="flex w-full items-center justify-center gap-1 border border-green-700 bg-green-950 px-2 py-1.5 text-[9px] font-bold uppercase">{playing ? <Pause size={12}/> : <Play size={12}/>} {playing ? "Pause sound" : <><Volume2 size={12}/> Play sound</>}</button>
    {error && <p role="alert" className="text-[8px] text-red-300">{error}</p>}
  </div>;
}
